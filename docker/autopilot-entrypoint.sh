#!/usr/bin/env bash
# x402 Autopilot tick loop.
#
# Runs forever inside the container. Each tick:
#   1. git fetch + checkout the long-lived autopilot branch
#   2. npm run agent:start (orientation)
#   3. claude headless with .agent/CLAUDE_LOOP.md as the prompt
#   4. npm run agent:end (refresh .agent/state.json)
#   5. optional git push (only when AGENT_AUTO_PUSH=true)
#   6. sleep AUTOPILOT_INTERVAL_HOURS
#
# The CLAUDE_LOOP.md itself contains the safety contract (never touch main,
# budget ≤60min per goal, no .ts files, etc).

set -u  # -e deliberately omitted: one bad tick must NOT kill the loop.

WORKDIR="${WORKDIR:-/workspace}"
BRANCH="${AUTOPILOT_BRANCH:-x402-api-gateway}"
INTERVAL_MINUTES="${AUTOPILOT_INTERVAL_MINUTES:-60}"
MAX_MINUTES="${AUTOPILOT_MAX_MINUTES:-60}"
MODEL="${AUTOPILOT_MODEL:-claude-opus-4-6}"
AUTO_PUSH="${AGENT_AUTO_PUSH:-false}"
LOOP_FILE="${AUTOPILOT_LOOP_FILE:-.agent/CLAUDE_LOOP.md}"
PAUSE_BASE_MINUTES="${AUTOPILOT_PAUSE_BASE_MINUTES:-30}"     # first backoff interval; doubles each retry, cap 4h
PAUSED_FILE=".agent/PAUSED"
PAUSE_RETRIES_FILE=".agent/PAUSE_RETRIES"
STUCK_FILE=".agent/STUCK.md"
STUCK_CHECK_MINUTES="${AUTOPILOT_STUCK_CHECK_MINUTES:-15}"  # how often to re-check STUCK state
USAGE_THRESHOLD_PCT="${AUTOPILOT_USAGE_THRESHOLD_PCT:-98}"
REPLENISH_THRESHOLD="${AUTOPILOT_REPLENISH_THRESHOLD:-1}"   # replenish when open goals ≤ this

log() { printf '[autopilot %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Pushes a ntfy.sh notification to NTFY_TOPIC if set. No-op otherwise so the
# loop never hard-fails when the env var is missing. Body is single-line ASCII
# to avoid ntfy.sh treating multi-line or long bodies as file attachments.
#
# Usage: notify "<title>" "<body>" [priority]
#   priority: min|low|default|high|urgent (default: default)
notify() {
  local title="$1"
  local body="$2"
  local priority="${3:-default}"
  if [ -z "${NTFY_TOPIC:-}" ]; then
    return 0
  fi
  # Strip non-ASCII and newlines from body so ntfy doesn't upgrade it to a file.
  local safe_body
  safe_body=$(printf '%s' "$body" | tr '\n' ' ' | tr -cd '\11\12\15\40-\176' | cut -c1-220)
  curl -sfS -m 5 -X POST "https://ntfy.sh/${NTFY_TOPIC}" \
    -H "Title: ${title}" \
    -H "Priority: ${priority}" \
    -H "Tags: robot,x402" \
    -d "${safe_body}" >/dev/null 2>&1 \
    && log "notify: sent (priority=${priority}, title='${title}')" \
    || log "notify: FAILED to reach ntfy.sh"
}

# Prints an API usage banner and returns 1 if token usage is at or above
# USAGE_THRESHOLD_PCT. Always logs a line — even when the probe is skipped —
# so every tick shows a consumption line in docker logs.
#
# Two auth paths:
#   API key   — curl probe reads anthropic-ratelimit-tokens-* response headers.
#   Pro/OAuth — no API key available; logs a note and skips the threshold gate.
check_api_headroom() {
  local tick="${1:-?}"

  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    log "[TICK #${tick}] API usage: Pro/OAuth auth — rate-limit headers unavailable (no ANTHROPIC_API_KEY). Threshold gate skipped."
    return 0
  fi

  local headers_file
  headers_file=$(mktemp)
  curl -s -D "$headers_file" -X POST "https://api.anthropic.com/v1/messages" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d '{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"ping"}]}' \
    -o /dev/null 2>/dev/null
  local curl_exit=$?

  local remaining limit
  remaining=$(grep -i 'anthropic-ratelimit-tokens-remaining:' "$headers_file" | grep -oE '[0-9]+' | head -1 || true)
  limit=$(grep -i 'anthropic-ratelimit-tokens-limit:' "$headers_file" | grep -oE '[0-9]+' | head -1 || true)
  rm -f "$headers_file"

  if [ "$curl_exit" -ne 0 ] || [ -z "$remaining" ] || [ -z "$limit" ] || [ "$limit" -eq 0 ]; then
    log "[TICK #${tick}] API usage: probe failed (curl=${curl_exit} remaining=${remaining:-?} limit=${limit:-?}) — assuming OK, threshold gate skipped."
    return 0
  fi

  local pct_used=$(( (limit - remaining) * 100 / limit ))
  local pct_remaining=$(( 100 - pct_used ))
  log "[TICK #${tick}] API usage: ${pct_used}% consumed, ${pct_remaining}% remaining (${remaining} tokens remaining of ${limit} limit)"

  if [ "$pct_used" -ge "$USAGE_THRESHOLD_PCT" ]; then
    log "[TICK #${tick}] API usage: ${pct_used}% >= threshold ${USAGE_THRESHOLD_PCT}% — triggering pause"
    return 1
  fi
  return 0
}

# Invokes claude with a focused goal-generation prompt when the backlog runs low.
# Appends new goals to GOALS.md and commits the result. Never idles.
replenish_goals() {
  local tick="$1"
  local open_count="$2"
  banner "GOAL REPLENISHMENT (open=${open_count} ≤ threshold=${REPLENISH_THRESHOLD})"
  log "replenish: backlog low — generating new goals"

  # Find the highest existing G-NNN so new IDs continue the sequence.
  local last_id
  last_id=$(grep -oE 'G-[0-9]+' GOALS.md 2>/dev/null | grep -oE '[0-9]+' | sort -n | tail -1 || echo "0")
  local next_id=$(( last_id + 1 ))

  # Gather lightweight project signals to give claude context.
  local coverage_pct
  coverage_pct=$(node -e "try{const s=JSON.parse(require('fs').readFileSync('.agent/state.json','utf8'));console.log(s.coveragePct);}catch(e){console.log('unknown');}" 2>/dev/null || echo "unknown")

  local todo_count
  todo_count=$(grep -rciE 'TODO|FIXME|HACK|XXX|STUB' src/ 2>/dev/null | awk -F: '{s+=$2} END {print s+0}' || echo 0)

  local test_file_count
  test_file_count=$(find tests/ -name '*.test.*' 2>/dev/null | wc -l | tr -d ' ' || echo 0)

  local src_file_count
  src_file_count=$(find src/ -name '*.js' 2>/dev/null | wc -l | tr -d ' ' || echo 0)

  local open_goals_text
  open_goals_text=$(grep -E '^\|\s*G-[0-9]+\s*\|\s*P[012]\s*\|\s*open\s*\|' GOALS.md 2>/dev/null || echo "(none)")

  local replenish_prompt_file
  replenish_prompt_file=$(mktemp /tmp/goal-gen-XXXXXX.md)

  cat > "$replenish_prompt_file" << GOAL_GEN_PROMPT
# Goal Replenishment Task

The x402 autopilot backlog is low (${open_count} open goals remaining). Your job is to generate a new batch of 8–12 goals and append them to GOALS.md.

## Project context

- Coverage: ${coverage_pct}% (target: 80%)
- TODO/FIXME/STUB markers in src/: ${todo_count}
- Test files: ${test_file_count}, Source files: ${src_file_count}
- Next goal ID to use: G-${next_id}

## Currently open goals (do not duplicate these)

${open_goals_text}

## How to generate goals

1. Read GOALS.md to understand what has already been done (Closed section).
2. Read src/ to find: TODOs, untested files, stub implementations, missing error handling, incomplete features.
3. Run \`npx vitest run --coverage 2>&1 | tail -40\` to see which files have the lowest coverage.
4. Grep for \`TODO\|FIXME\|STUB\|placeholder\` in src/ to find concrete work items.
5. Check infra/stacks/ to see what CDK resources may be missing or incomplete.
6. Think about: integration tests, deployment readiness, security hardening, observability gaps, documentation.

## Rules

- Generate exactly 8–12 new goals starting at G-${next_id}.
- Assign priorities: P0 = critical (security, broken tests, coverage <50%), P1 = this-week, P2 = backlog.
- Each goal must be completable in ≤ 60 minutes by one agent tick.
- No goal should duplicate anything in the Closed section.
- Write concrete, actionable titles — not vague ("improve code quality") but specific ("Write unit tests for adapters/xrpl-evm/client.js using vi.mock ethers").
- Focus areas in priority order: (1) test coverage toward 80%, (2) CDK deployment completeness, (3) TODO/stub removal, (4) security/observability gaps, (5) documentation.

## Output format

Append the new goal rows to the Active table in GOALS.md using this exact format:
\`\`\`
| G-NNN | P0 | open | 45m | <title> |
\`\`\`

After appending, commit with:
\`\`\`
git add GOALS.md
git commit -m "chore(autopilot): replenish goals — G-${next_id} through G-\$(last id added)" --author="x402 autopilot <autopilot@x402.local>"
\`\`\`

Do only this. Do not start working on any goal. Do not modify any source files.
GOAL_GEN_PROMPT

  log "replenish: invoking claude for goal generation (prompt: $replenish_prompt_file)"
  timeout "${MAX_MINUTES}m" claude \
    --dangerously-skip-permissions \
    --model "$MODEL" \
    --print \
    "$(cat "$replenish_prompt_file")" \
    > ".agent/last-replenish.log" 2>&1
  local replenish_exit=$?
  rm -f "$replenish_prompt_file"

  log "replenish: claude exit=${replenish_exit}"

  local new_open
  new_open=$(grep -cE '^\|\s*G-[0-9]+\s*\|\s*P[012]\s*\|\s*open\s*\|' GOALS.md 2>/dev/null || echo 0)
  log "replenish: goals after replenishment: open=${new_open}"

  if [ "$new_open" -le "$open_count" ]; then
    log "WARN: replenishment did not add new open goals — claude may have failed. Check .agent/last-replenish.log"
  else
    log "replenish: added $((new_open - open_count)) new goals to GOALS.md"
  fi
}

# Returns 0 if last-tick.log contains signals of API token/credit exhaustion.
# Patterns must be specific to Anthropic API error responses — avoid bare terms
# like "rate limit" or "Payment Required" that appear in normal x402 project output.
is_token_exhausted() {
  grep -qiE \
    'rate limit exceeded|rate.?limit.{0,30}(error|exceeded|reached|hit)|insufficient_balance|insufficient credit|credit balance (too low|exhausted|depleted)|quota exceeded|quota.{0,20}reached|overloaded.*please try|529: |error.*529|credit exhausted|your (account|plan|trial).{0,30}(expired|ended|exceeded|limit)|exceeded your (monthly|daily|current) quota|billing (error|required|failed)|no active (subscription|plan|credit)' \
    ".agent/last-tick.log" 2>/dev/null
}

# Returns the next backoff sleep duration in minutes using exponential backoff.
# Sequence: 30, 60, 120, 240, 240, 240, ... (base doubles each retry, capped at 4h).
get_backoff_minutes() {
  local retries
  retries=$(cat "$PAUSE_RETRIES_FILE" 2>/dev/null | tr -d '[:space:]' || echo 0)
  # Clamp to integer in case file is corrupt.
  retries=$(( retries + 0 )) 2>/dev/null || retries=0
  local mins=$(( PAUSE_BASE_MINUTES * (1 << retries) ))
  [ "$mins" -gt 240 ] && mins=240
  echo "$mins"
}

increment_pause_retries() {
  local retries
  retries=$(cat "$PAUSE_RETRIES_FILE" 2>/dev/null | tr -d '[:space:]' || echo 0)
  retries=$(( retries + 0 )) 2>/dev/null || retries=0
  echo $(( retries + 1 )) > "$PAUSE_RETRIES_FILE"
}

reset_pause_retries() {
  echo 0 > "$PAUSE_RETRIES_FILE"
  log "backoff: retry count reset to 0 (successful tick)"
}

# Commits any uncommitted work-in-progress and sleeps for the next backoff interval.
# Uses exponential backoff: 30m → 60m → 120m → 240m (cap). Retry count persists
# in PAUSE_RETRIES_FILE across ticks so repeated failures back off progressively.
pause_on_exhaustion() {
  local tick="$1"
  local reason="${2:-token exhaustion}"
  local sleep_minutes
  sleep_minutes=$(get_backoff_minutes)
  increment_pause_retries
  local new_retries
  new_retries=$(cat "$PAUSE_RETRIES_FILE" 2>/dev/null || echo "?")

  log "PAUSE: reason='${reason}' retry=#${new_retries} sleeping=${sleep_minutes}m — committing any WIP"
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    git add -A
    git commit -m "wip(autopilot): pause checkpoint — ${reason} at tick #${tick}" \
      --author="x402 autopilot <autopilot@x402.local>" 2>/dev/null \
      && log "WIP committed" || log "WARN: WIP commit failed (nothing staged?)"
  else
    log "working tree clean — no WIP to commit"
  fi
  printf '%s reason=%s tick=%s retry=%s sleep=%sm\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$reason" "$tick" "$new_retries" "$sleep_minutes" \
    > "$PAUSED_FILE"
  log "PAUSED: sleeping ${sleep_minutes}m (retry #${new_retries}, next would be $(( sleep_minutes * 2 < 240 ? sleep_minutes * 2 : 240 ))m). Remove $PAUSED_FILE to force-resume immediately."
  sleep "$((sleep_minutes * 60))"
  rm -f "$PAUSED_FILE"
  log "PAUSED: retry window elapsed — resuming tick loop"
}

# Fires a minimal one-line prompt at claude-haiku using the mounted Pro/Max auth
# to verify credits are available before spending a full tick. Writes output to
# .agent/last-canary.log. Returns 1 (skip tick) if the call fails or returns
# exhaustion signals.
canary_check() {
  local tick="$1"
  local canary_log=".agent/last-canary.log"
  log "[TICK #${tick}] canary: verifying credits with test call (model=claude-haiku-4-5-20251001, timeout=2m)..."

  # Retry up to 3 times if we hit a transient `.claude.json` config-parse
  # error (the host's interactive Claude Code session writing to its config
  # at the same instant). This is NOT an exhaustion signal and should not
  # burn a 30-minute pause.
  local canary_exit=1
  local attempt
  for attempt in 1 2 3; do
    timeout 2m claude \
      --dangerously-skip-permissions \
      --model "claude-haiku-4-5-20251001" \
      --print \
      "respond with OK" \
      > "$canary_log" 2>&1
    canary_exit=$?

    if [ "$canary_exit" -eq 0 ]; then
      break
    fi

    # Transient config-parse error: re-copy host snapshot and retry.
    if grep -qiE 'Configuration error in .*\.claude\.json' "$canary_log" 2>/dev/null; then
      log "[TICK #${tick}] canary: transient .claude.json parse error (attempt ${attempt}/3) — re-copying host snapshot"
      if [ -f "$HOME/.claude.json.host" ]; then
        cp "$HOME/.claude.json.host" "$HOME/.claude.json.tmp" 2>/dev/null || true
        if node -e "JSON.parse(require('fs').readFileSync('$HOME/.claude.json.tmp','utf8'))" 2>/dev/null; then
          mv "$HOME/.claude.json.tmp" "$HOME/.claude.json"
        else
          rm -f "$HOME/.claude.json.tmp"
        fi
      fi
      sleep 2
      continue
    fi

    # Non-transient failure: no retry.
    break
  done

  if [ "$canary_exit" -ne 0 ]; then
    log "[TICK #${tick}] canary: FAILED (exit=${canary_exit}) — credits likely unavailable. Check .agent/last-canary.log"
    local canary_snippet
    canary_snippet=$(head -3 "$canary_log" 2>/dev/null | tr '\n' ' ' | cut -c1-160)
    notify "x402 autopilot canary FAIL" \
      "tick #${tick}: exit=${canary_exit} after 3 retries. ${canary_snippet}" \
      "high"
    return 1
  fi

  # Reuse is_token_exhausted logic against the canary log.
  if grep -qiE \
    'rate limit exceeded|rate.?limit.{0,30}(error|exceeded|reached|hit)|insufficient_balance|insufficient credit|credit balance (too low|exhausted|depleted)|quota exceeded|quota.{0,20}reached|overloaded.*please try|529: |error.*529|credit exhausted|your (account|plan|trial).{0,30}(expired|ended|exceeded|limit)|exceeded your (monthly|daily|current) quota|billing (error|required|failed)|no active (subscription|plan|credit)' \
    "$canary_log" 2>/dev/null; then
    log "[TICK #${tick}] canary: exhaustion signal detected in response. Check .agent/last-canary.log"
    notify "x402 autopilot credits EXHAUSTED" \
      "tick #${tick}: rate limit / quota / billing signal in canary response" \
      "urgent"
    return 1
  fi

  local canary_response
  canary_response=$(head -1 "$canary_log" | tr -d '\n' | cut -c1-80)
  log "[TICK #${tick}] canary: OK (exit=0, response='${canary_response}')"
  return 0
}

# Returns 0 if the canary log shows a network/API outage (not exhaustion or
# auth failure). Used to decide whether to retry the canary with a short wait
# (the API should come back in minutes) vs. enter the long exponential-backoff
# pause (which is appropriate for billing/quota/auth issues that need a human).
is_network_outage() {
  local canary_log="$1"
  [ -f "$canary_log" ] || return 1
  grep -qiE \
    'network error|connection (refused|reset|timed? out|closed)|socket hang up|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|EAI_AGAIN|getaddrinfo|DNS lookup failed|could not (connect|resolve|reach)|unreachable|request timed out|HTTP/[12](\.[01])? 5[0-9]{2}|status code 5[0-9]{2}|service unavailable|bad gateway|gateway timeout|upstream.{0,30}(unavailable|timeout)|fetch failed|ENOBUFS|EPIPE|read ECONNRESET|write EPIPE' \
    "$canary_log" 2>/dev/null
}

# Visual banner so each phase is easy to spot in the log stream.
banner() {
  local title="$1"
  printf '\n\033[1;36m┌────────────────────────────────────────────────────────┐\033[0m\n'
  printf   '\033[1;36m│\033[0m  %-52s  \033[1;36m│\033[0m\n' "$title"
  printf   '\033[1;36m└────────────────────────────────────────────────────────┘\033[0m\n'
}

cd "$WORKDIR" || { log "FATAL: cannot cd to $WORKDIR"; exit 1; }

# Mark workspace safe for git (ownership across host/container volume mounts).
# We write to a container-local config path, not to any mounted host file.
export GIT_CONFIG_GLOBAL="$HOME/.gitconfig-autopilot"
touch "$GIT_CONFIG_GLOBAL" 2>/dev/null || true
git config --global --add safe.directory "$WORKDIR" || true
git config --global --add safe.directory '*' || true
git config --global user.name  "${GIT_AUTHOR_NAME:-x402 autopilot}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-autopilot@x402.local}"

log "boot: branch=$BRANCH interval=${INTERVAL_MINUTES}m max=${MAX_MINUTES}m model=$MODEL push=$AUTO_PUSH pause_base=${PAUSE_BASE_MINUTES}m usage_threshold=${USAGE_THRESHOLD_PCT}%"

if [ -n "${NTFY_TOPIC:-}" ]; then
  log "notify: ntfy.sh configured (topic=***$(printf '%s' "$NTFY_TOPIC" | tail -c 4))"
else
  log "notify: DISABLED (set NTFY_TOPIC in .env to enable phone alerts)"
fi
notify "x402 autopilot ONLINE" \
  "container booted: branch=${BRANCH} interval=${INTERVAL_MINUTES}m model=${MODEL}" \
  "low"

# Copy SSH keys to a writable location and fix permissions — bind mounts
# from Windows come through as 0755 which ssh refuses. We copy once at boot
# and chmod 600/644 so ssh will actually use the key.
if [ -d "$HOME/.ssh" ]; then
  log "setting up ssh keys with correct perms"
  mkdir -p "$HOME/.ssh-writable"
  cp -r "$HOME"/.ssh/. "$HOME/.ssh-writable/" 2>/dev/null || true
  chmod 700 "$HOME/.ssh-writable"
  # Private keys → 0600, public keys and known_hosts → 0644
  find "$HOME/.ssh-writable" -type f -name 'id_*' ! -name '*.pub' -exec chmod 600 {} \; 2>/dev/null || true
  find "$HOME/.ssh-writable" -type f \( -name '*.pub' -o -name 'known_hosts*' -o -name 'config' \) -exec chmod 644 {} \; 2>/dev/null || true
  # Redirect ssh to use the writable copy.
  export GIT_SSH_COMMAND="ssh -i $HOME/.ssh-writable/id_rsa -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$HOME/.ssh-writable/known_hosts"
  log "ssh ready (keys in $HOME/.ssh-writable)"
fi

# Copy ~/.claude.json from the read-only side-path mount to the real writable
# location. The host's interactive Claude Code session writes to ~/.claude.json
# constantly; if we bind-mount that same file RW into the container the canary
# catches it mid-write and fails with "Configuration error ... at position
# 44735". Side-path mount + copy gives the container its own stable writable
# snapshot that host activity cannot corrupt. If the host file is mid-write at
# the instant we copy, retry up to 5 times with a 1s sleep until jq can parse it.
if [ -f "$HOME/.claude.json.host" ]; then
  for attempt in 1 2 3 4 5; do
    cp "$HOME/.claude.json.host" "$HOME/.claude.json.tmp" 2>/dev/null || true
    if node -e "JSON.parse(require('fs').readFileSync('$HOME/.claude.json.tmp','utf8'))" 2>/dev/null; then
      mv "$HOME/.claude.json.tmp" "$HOME/.claude.json"
      log "claude.json: snapshot from host ok (attempt ${attempt})"
      break
    fi
    log "claude.json: host file mid-write, retrying (attempt ${attempt}/5)"
    rm -f "$HOME/.claude.json.tmp"
    sleep 1
  done
  if [ ! -f "$HOME/.claude.json" ]; then
    log "WARN: could not get a valid snapshot of host .claude.json after 5 attempts — Claude CLI may fail"
  fi
fi

# Sanity: Claude Code auth present?
if [ ! -d "$HOME/.claude" ] && [ ! -f "$HOME/.claude.json" ]; then
  log "WARN: no ~/.claude credentials found — mount host ~/.claude into the container or claude will fail to auth"
fi

# Sanity: node_modules present?
if [ ! -d node_modules ]; then
  log "first boot: running npm ci"
  npm ci --no-audit --no-fund || log "WARN: npm ci failed — continuing anyway"
fi

tick_number=0

while true; do
  tick_number=$((tick_number + 1))
  log "==================== TICK #${tick_number} START ===================="

  # Clear stale PAUSED marker and reset retry count on fresh container start
  # (tick_number=1 means this is the first tick after boot).
  if [ "$tick_number" -eq 1 ]; then
    [ -f "$PAUSED_FILE" ] && { log "stale $PAUSED_FILE found — clearing"; rm -f "$PAUSED_FILE"; }
    [ -f "$PAUSE_RETRIES_FILE" ] && { log "stale $PAUSE_RETRIES_FILE found — resetting to 0"; echo 0 > "$PAUSE_RETRIES_FILE"; }
  fi

  # ── SECTION 0: SUPERVISOR HALT CHECK ──────────────────────────────────
  # If the supervisor previously declared STUCK, halt the tick loop until
  # a human removes the marker file. Don't burn any API tokens while stuck.
  if [ -f "$STUCK_FILE" ]; then
    banner "AUTOPILOT HALTED BY SUPERVISOR"
    log "$STUCK_FILE present — supervisor halted the tick loop"
    log "diagnosis: $(head -1 "$STUCK_FILE" 2>/dev/null)"
    log "to resume: rm $STUCK_FILE  (or close the linked GitHub issue)"
    log "re-checking in ${STUCK_CHECK_MINUTES}m..."
    tick_number=$((tick_number - 1))   # don't burn tick numbers while halted
    sleep "$((STUCK_CHECK_MINUTES * 60))"
    continue
  fi

  # Ensure we are on the autopilot branch (create from current HEAD if missing).
  # The autopilot branch is container-owned: origin/$BRANCH is the single
  # source of truth. Any local-only commits (from a failed push last tick,
  # or from a half-completed tick) are intentionally discarded so that a
  # host-side push can never desync with a container-side tick. Without this
  # hard sync, `pull --ff-only` fails silently when local has diverged, the
  # tick runs on a stale base, and successive ticks drift further from origin.
  git fetch --all --prune 2>/dev/null || log "WARN: git fetch failed"
  if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
    git checkout "$BRANCH" 2>/dev/null || log "WARN: checkout $BRANCH failed"
    if git show-ref --verify --quiet "refs/remotes/origin/${BRANCH}"; then
      LOCAL_SHA="$(git rev-parse HEAD 2>/dev/null || echo none)"
      ORIGIN_SHA="$(git rev-parse "origin/${BRANCH}" 2>/dev/null || echo none)"
      if [ "$LOCAL_SHA" != "$ORIGIN_SHA" ]; then
        log "sync: local=$LOCAL_SHA origin=$ORIGIN_SHA — hard-resetting to origin/$BRANCH"
        git reset --hard "origin/${BRANCH}" 2>/dev/null || log "WARN: reset to origin/$BRANCH failed"
        git clean -fd 2>/dev/null || true
      else
        log "sync: local in sync with origin/$BRANCH at $LOCAL_SHA"
      fi
    else
      log "sync: no origin/$BRANCH yet (first run?)"
    fi
  else
    log "creating local branch $BRANCH from HEAD"
    git checkout -b "$BRANCH" 2>/dev/null || log "WARN: could not create $BRANCH"
  fi

  # BRANCH LOCK with auto-recovery: the host's bind-mounted working tree
  # can drift to other branches when humans do local work (git log on
  # another branch, rebases, cherry-picks, etc). Instead of aborting and
  # burning a 15-min tick, try to recover by stashing any uncommitted
  # changes and checking out the expected branch. Only abort if recovery
  # itself fails (prevents destructive operations on truly dirty state).
  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
    log "WARN: HEAD drifted to '$CURRENT_BRANCH' — auto-recovering to $BRANCH"

    # Stash any uncommitted changes so checkout won't be blocked.
    # Tagged with RECOVERY so a human can find it if needed. Safe to
    # leave in stash list; never auto-restored since the tick is
    # starting fresh from origin anyway.
    RECOVERY_STASH_MSG="autopilot-recovery-$(date -u +%Y%m%dT%H%M%SZ)"
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
      log "recovery: stashing dirty state as '$RECOVERY_STASH_MSG'"
      git stash push -u -m "$RECOVERY_STASH_MSG" >/dev/null 2>&1 \
        || log "WARN: recovery stash failed (continuing — checkout may still succeed)"
    fi

    # Attempt the checkout. If origin has the branch we'll land on it;
    # otherwise fall through to the abort path below.
    if git checkout "$BRANCH" 2>/dev/null; then
      log "recovery: checkout $BRANCH OK"
      CURRENT_BRANCH="$BRANCH"
    else
      log "ABORT: auto-recovery failed — could not checkout $BRANCH from '$CURRENT_BRANCH'"
      sleep "$((INTERVAL_MINUTES * 60))"
      continue
    fi
  fi
  log "branch lock OK: on $CURRENT_BRANCH"

  # Record the SHA BEFORE claude runs so we can revert if post-tick gates fail.
  PRE_TICK_SHA="$(git rev-parse HEAD 2>/dev/null)"

  # ── SECTION 1: GOAL FOR THIS TICK ─────────────────────────────────────
  banner "GOAL FOR TICK #${tick_number}"
  log "agent:start (orientation)"
  npm run --silent agent:start || log "WARN: agent:start failed"

  # Pull the picked goal line out of GOALS.md and show full row.
  TICK_GOAL_LINE="$(grep -E '^\|\s*G-[0-9]+\s*\|\s*P[012]\s*\|\s*(open|in_progress)\s*\|' GOALS.md 2>/dev/null | sort -t'|' -k3,3 | head -1 || true)"
  if [ -n "$TICK_GOAL_LINE" ]; then
    printf '  %s\n' "$TICK_GOAL_LINE"
  fi

  # Pre-tick gate: lint MUST be green (it's cheap to keep clean). Tests
  # are measured as a BASELINE — Claude is allowed to run even if tests
  # are red, so it can fix them. The post-tick gate will revert if Claude
  # makes the test situation *worse*.
  log "pre-tick gate: lint"
  if ! npm run --silent lint; then
    log "ABORT tick: pre-tick lint is red — skipping"
    sleep "$((INTERVAL_MINUTES * 60))"
    continue
  fi
  log "pre-tick baseline: test"
  npx --no vitest run --coverage.enabled=false --reporter=default \
    > .agent/pre-tick-tests.log 2>&1
  PRE_TEST_EXIT=$?
  PRE_TEST_FAILED_FILES=$(grep -cE '^ FAIL ' .agent/pre-tick-tests.log 2>/dev/null | tail -1 || echo 0)
  PRE_TEST_PASSED_COUNT=$(grep -oE 'Tests\s+[0-9]+ passed' .agent/pre-tick-tests.log | grep -oE '[0-9]+' | tail -1 || echo 0)
  log "pre-tick baseline: exit=$PRE_TEST_EXIT failed_files=$PRE_TEST_FAILED_FILES passed_tests=$PRE_TEST_PASSED_COUNT"

  # ── SECTION 2: CLAUDE IS WORKING ──────────────────────────────────────
  banner "CLAUDE IS WORKING (max ${MAX_MINUTES}m)"

  # Proactive headroom check (API key path only — logs usage banner regardless).
  if ! check_api_headroom "$tick_number"; then
    log "HEADROOM: usage at/above ${USAGE_THRESHOLD_PCT}% — pausing before invoking claude"
    pause_on_exhaustion "$tick_number" "headroom_threshold"
    continue
  fi

  # Canary call — lightweight test to verify credits are available before
  # spending a full tick budget. If the canary fails because the Claude API
  # itself is unreachable (network/upstream outage), wait 5 min and retry up
  # to an hour before giving up — network outages typically resolve faster
  # than the 30-min exhaustion backoff. Exhaustion / auth / unknown failures
  # fall through to the existing exponential pause.
  CANARY_LOG_PATH=".agent/last-canary.log"
  OUTAGE_WAIT_MIN=5
  OUTAGE_MAX_RETRIES=12   # 12 × 5 min = 1 hour outage tolerance
  outage_attempt=0
  canary_ok="false"
  while : ; do
    if canary_check "$tick_number"; then
      canary_ok="true"
      break
    fi
    if ! is_network_outage "$CANARY_LOG_PATH"; then
      log "[TICK #${tick_number}] canary failed with non-outage signal — entering backoff"
      break
    fi
    outage_attempt=$((outage_attempt + 1))
    if [ "$outage_attempt" -gt "$OUTAGE_MAX_RETRIES" ]; then
      log "[TICK #${tick_number}] outage persisted >$((OUTAGE_WAIT_MIN * OUTAGE_MAX_RETRIES)) min — entering long backoff"
      notify "x402 autopilot outage PERSISTS" \
        "tick #${tick_number}: Claude API outage >1h; falling through to exponential backoff" \
        "urgent"
      break
    fi
    log "[TICK #${tick_number}] Claude API appears DOWN (outage attempt ${outage_attempt}/${OUTAGE_MAX_RETRIES}) — waiting ${OUTAGE_WAIT_MIN} min and retrying canary"
    sleep $((OUTAGE_WAIT_MIN * 60))
  done
  if [ "$canary_ok" != "true" ]; then
    log "[TICK #${tick_number}] canary failed — skipping tick, entering backoff"
    pause_on_exhaustion "$tick_number" "canary_failed"
    continue
  fi

  # Re-read model and effort from dashboard config files (if set).
  if [ -f ".agent/MODEL" ]; then
    FILE_MODEL=$(cat ".agent/MODEL" 2>/dev/null | tr -d '[:space:]')
    [ -n "$FILE_MODEL" ] && MODEL="$FILE_MODEL"
  fi
  EFFORT_FLAG=""
  if [ -f ".agent/EFFORT" ]; then
    FILE_EFFORT=$(cat ".agent/EFFORT" 2>/dev/null | tr -d '[:space:]')
    [ -n "$FILE_EFFORT" ] && EFFORT_FLAG="--effort $FILE_EFFORT"
  fi

  log "invoking claude with model=$MODEL effort=${FILE_EFFORT:-default}"
  CLAUDE_START_TS=$(date +%s)
  # shellcheck disable=SC2086
  timeout "${MAX_MINUTES}m" claude \
    --dangerously-skip-permissions \
    --model "$MODEL" \
    $EFFORT_FLAG \
    --print \
    "$(cat "$LOOP_FILE")" \
    > ".agent/last-tick.log" 2>&1
  CLAUDE_EXIT=$?
  CLAUDE_DURATION=$(( $(date +%s) - CLAUDE_START_TS ))
  log "claude exit=$CLAUDE_EXIT duration=${CLAUDE_DURATION}s (log: .agent/last-tick.log)"

  # Token/credit exhaustion check — must happen before post-tick gates.
  # If the API refused due to billing/quota, commit WIP and pause; do not
  # hammer the API again on the normal interval.
  if is_token_exhausted; then
    log "TOKEN EXHAUSTION detected in last-tick.log"
    pause_on_exhaustion "$tick_number" "token_exhausted"
    continue
  fi

  # Post-tick gate #1: lint must stay green. Tests are compared to
  # baseline — Claude must not make things WORSE.
  log "post-tick gate: lint + test-delta vs baseline"
  POST_OK=1
  if ! npm run --silent lint; then
    log "POST-TICK FAIL: lint went red"
    POST_OK=0
  fi
  npx --no vitest run --coverage.enabled=false --reporter=default \
    > .agent/post-tick-tests.log 2>&1
  POST_TEST_EXIT=$?
  POST_TEST_FAILED_FILES=$(grep -cE '^ FAIL ' .agent/post-tick-tests.log 2>/dev/null | tail -1 || echo 0)
  POST_TEST_PASSED_COUNT=$(grep -oE 'Tests\s+[0-9]+ passed' .agent/post-tick-tests.log | grep -oE '[0-9]+' | tail -1 || echo 0)
  log "post-tick result: exit=$POST_TEST_EXIT failed_files=$POST_TEST_FAILED_FILES passed_tests=$POST_TEST_PASSED_COUNT"

  # Worse = more failed files OR fewer passing tests than baseline.
  if [ "$POST_TEST_FAILED_FILES" -gt "$PRE_TEST_FAILED_FILES" ]; then
    log "POST-TICK FAIL: failed_files went from $PRE_TEST_FAILED_FILES → $POST_TEST_FAILED_FILES"
    POST_OK=0
  fi
  if [ "$POST_TEST_PASSED_COUNT" -lt "$PRE_TEST_PASSED_COUNT" ]; then
    log "POST-TICK FAIL: passed_tests went from $PRE_TEST_PASSED_COUNT → $POST_TEST_PASSED_COUNT"
    POST_OK=0
  fi

  if [ "$POST_OK" -eq 0 ]; then
    log "POST-TICK RED: hard-reverting to pre-tick SHA $PRE_TICK_SHA"
    git reset --hard "$PRE_TICK_SHA" 2>/dev/null || true
    git clean -fd  2>/dev/null || true
  else
    log "POST-TICK GREEN: lint OK, tests same-or-better than baseline"
    reset_pause_retries
  fi

  # Post-tick gate #2: secret scan on the diff vs pre-tick SHA.
  log "post-tick gate: secret scan"
  if ! /usr/local/bin/secret-scan.sh "$PRE_TICK_SHA"; then
    log "SECRETS DETECTED: hard-reverting to pre-tick SHA $PRE_TICK_SHA"
    git reset --hard "$PRE_TICK_SHA" 2>/dev/null || true
    git clean -fd 2>/dev/null || true
    notify "x402 SECRET LEAK BLOCKED" \
      "tick #${tick_number}: secret-scan.sh matched a pattern in the diff. Tick reverted to ${PRE_TICK_SHA:0:8}. Check docker logs." \
      "urgent"
  fi

  # ── SECTION 3: WHAT CHANGED ───────────────────────────────────────────
  banner "WHAT CHANGED THIS TICK"
  POST_TICK_SHA="$(git rev-parse HEAD 2>/dev/null)"
  if [ "$POST_TICK_SHA" = "$PRE_TICK_SHA" ]; then
    log "(no commits made this tick)"
  else
    log "commits added:"
    git log --oneline "${PRE_TICK_SHA}..HEAD" 2>/dev/null | sed 's/^/  /'
    log "diff stat:"
    git diff --stat "${PRE_TICK_SHA}" "${POST_TICK_SHA}" 2>/dev/null | sed 's/^/  /'

    # If any NORTH_STAR counter moved this tick, that's a real ship — notify.
    if git diff --name-only "$PRE_TICK_SHA" "$POST_TICK_SHA" 2>/dev/null | grep -q '^\.agent/NORTH_STAR\.json$'; then
      OLD_402=$(git show "${PRE_TICK_SHA}:.agent/NORTH_STAR.json" 2>/dev/null \
        | grep -oE '"real_402_issued_count"[[:space:]]*:[[:space:]]*[0-9]+' \
        | grep -oE '[0-9]+$' | head -1)
      NEW_402=$(grep -oE '"real_402_issued_count"[[:space:]]*:[[:space:]]*[0-9]+' .agent/NORTH_STAR.json 2>/dev/null \
        | grep -oE '[0-9]+$' | head -1)
      OLD_SETTLED=$(git show "${PRE_TICK_SHA}:.agent/NORTH_STAR.json" 2>/dev/null \
        | grep -oE '"real_usdc_settled_count"[[:space:]]*:[[:space:]]*[0-9]+' \
        | grep -oE '[0-9]+$' | head -1)
      NEW_SETTLED=$(grep -oE '"real_usdc_settled_count"[[:space:]]*:[[:space:]]*[0-9]+' .agent/NORTH_STAR.json 2>/dev/null \
        | grep -oE '[0-9]+$' | head -1)
      OLD_402="${OLD_402:-0}"; NEW_402="${NEW_402:-0}"
      OLD_SETTLED="${OLD_SETTLED:-0}"; NEW_SETTLED="${NEW_SETTLED:-0}"
      if [ "$NEW_402" -gt "$OLD_402" ] || [ "$NEW_SETTLED" -gt "$OLD_SETTLED" ]; then
        SHIP_TITLE=$(git log -1 --pretty=format:%s "$POST_TICK_SHA" 2>/dev/null | cut -c1-100)
        notify "x402 SHIPPED" \
          "402s ${OLD_402} -> ${NEW_402}, settled ${OLD_SETTLED} -> ${NEW_SETTLED}. ${SHIP_TITLE}" \
          "default"
      fi
    fi
  fi

  # Refresh state snapshot.
  log "agent:end (regenerate state snapshot)"
  npm run --silent agent:end -- --tag="tick-${tick_number}" || log "WARN: agent:end failed"

  # Commit state.json refresh if anything is staged/modified.
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit -m "chore(autopilot): tick #${tick_number} state refresh" \
      --author="x402 autopilot <autopilot@x402.local>" \
      2>/dev/null || log "WARN: commit failed"
  fi

  # ── SECTION 4: AWS HANDOFF ────────────────────────────────────────────
  banner "AWS HANDOFF (state snapshot)"
  if [ -f .agent/state.json ]; then
    log "state.json (would mirror to DDB x402-agent-state):"
    cat .agent/state.json | sed 's/^/  /'
  fi
  # Per-goal counts (would mirror to DDB x402-agent-goals).
  OPEN=$(grep -cE '^\|\s*G-[0-9]+\s*\|\s*P[012]\s*\|\s*open\s*\|' GOALS.md 2>/dev/null || echo 0)
  DONE=$(grep -cE '^\|\s*G-[0-9]+\s*\|\s*P[012]\s*\|\s*done\s*\|' GOALS.md 2>/dev/null || echo 0)
  INPROG=$(grep -cE '^\|\s*G-[0-9]+\s*\|\s*P[012]\s*\|\s*in_progress\s*\|' GOALS.md 2>/dev/null || echo 0)
  log "goals: open=${OPEN} in_progress=${INPROG} done=${DONE}"

  # Auto-replenish when the backlog drops to the threshold. This runs at the
  # END of a tick so new goals are ready for the NEXT tick — the agent never idles.
  if [ "$OPEN" -le "$REPLENISH_THRESHOLD" ]; then
    log "goals: open=${OPEN} ≤ threshold=${REPLENISH_THRESHOLD} — triggering replenishment"
    replenish_goals "$tick_number" "$OPEN"
  fi
  if [ "${AGENT_SYNC:-false}" = "true" ] 2>/dev/null; then
    log "(AGENT_SYNC=true — would POST state to DDB here — stubbed in Phase 2)"
  else
    log "(AGENT_SYNC disabled — handoff is log-only until AWS stack ships)"
  fi

  # ── SECTION 4b: SUPERVISOR (loop + polish-before-ship detector) ──────
  banner "SUPERVISOR REVIEW"
  node scripts/agent/supervisor.js --tick="$tick_number" 2>&1 | sed 's/^/  /'
  SUPERVISOR_EXIT=${PIPESTATUS[0]}
  if [ "$SUPERVISOR_EXIT" -eq 0 ]; then
    log "supervisor: tick #${tick_number} healthy — continuing normally"
  else
    log "supervisor: STUCK declared at tick #${tick_number} — next tick will halt"
    # Commit the STUCK artifacts so they push to origin and surface in the dashboard / GitHub issue.
    if [ -n "$(git status --porcelain .agent/ 2>/dev/null)" ]; then
      git add .agent/STUCK.md .agent/SUPERVISOR_LOG.jsonl .agent/NORTH_STAR_HISTORY.jsonl .agent/NORTH_STAR.json 2>/dev/null || true
      git commit -m "chore(autopilot): supervisor halted — STUCK at tick #${tick_number}" \
        --author="x402 autopilot <autopilot@x402.local>" 2>/dev/null \
        && log "STUCK artifacts committed" || log "WARN: STUCK commit failed"
    fi
    # Ping D-rock's phone so a halt never hides in docker logs.
    STUCK_REASON="plateau"
    if [ -f .agent/STUCK.md ]; then
      STUCK_REASON=$(grep -m1 -iE 'north star|coverage|plateau|delta' .agent/STUCK.md 2>/dev/null \
        | sed -e 's/^[[:space:]]*[-*][[:space:]]*//' -e 's/`//g' | cut -c1-140)
      [ -z "$STUCK_REASON" ] && STUCK_REASON="see .agent/STUCK.md"
    fi
    notify "x402 autopilot HALTED" \
      "tick #${tick_number}: ${STUCK_REASON}. rm .agent/STUCK.md to resume." \
      "high"
  fi

  # Optional push — double-check branch lock before pushing to origin.
  # PUSH_RESULT is consumed by the tick summary below so we never lie about
  # whether the push actually landed. Values: yes | rescued | aborted:drift |
  # failed | disabled.
  PUSH_RESULT="disabled"
  PUSH_HEAD_BRANCH=""
  if [ "$AUTO_PUSH" = "true" ]; then
    PUSH_HEAD_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
    if [ "$PUSH_HEAD_BRANCH" != "$BRANCH" ]; then
      # HEAD drifted mid-tick (agent ran `git checkout` despite CLAUDE_LOOP.md
      # forbidding it, or a script switched branches). Don't let the work rot
      # on the wrong local branch — push current HEAD to origin/$BRANCH via
      # refspec so the commits are preserved. Entrypoint auto-recovery will
      # realign local HEAD next tick. Only rescue when current HEAD is a
      # strict fast-forward of origin/$BRANCH; otherwise refuse.
      log "WARN: HEAD drifted to '$PUSH_HEAD_BRANCH' mid-tick — attempting rescue push"
      if git merge-base --is-ancestor "origin/$BRANCH" "$PUSH_HEAD_BRANCH" 2>/dev/null; then
        if git push origin "${PUSH_HEAD_BRANCH}:${BRANCH}" 2>&1 | sed 's/^/  /'; then
          log "rescue push OK — commits preserved on origin/$BRANCH"
          PUSH_RESULT="rescued"
        else
          log "ABORT push: rescue push failed"
          PUSH_RESULT="failed"
        fi
      else
        log "ABORT push: '$PUSH_HEAD_BRANCH' is not a fast-forward of origin/$BRANCH — refusing"
        PUSH_RESULT="aborted:drift"
      fi
    else
      log "pushing to origin/$BRANCH"
      if git push origin "$BRANCH" 2>&1 | sed 's/^/  /'; then
        PUSH_RESULT="yes"
      else
        log "WARN: push failed"
        PUSH_RESULT="failed"
      fi
    fi
  fi

  # ── TICK SUMMARY ──────────────────────────────────────────────────────
  banner "TICK #${tick_number} SUMMARY"
  log "goal line:  ${TICK_GOAL_LINE:-<none>}"
  log "claude:     exit=$CLAUDE_EXIT in ${CLAUDE_DURATION}s"
  # Count commits made this tick. Use the branch that HEAD is actually on
  # (PUSH_HEAD_BRANCH) so we don't falsely report "N new on $BRANCH" when the
  # agent drifted and the commits are really on a different branch.
  TICK_COMMIT_COUNT="$(git rev-list --count ${PRE_TICK_SHA}..HEAD 2>/dev/null)"
  TICK_COMMIT_BRANCH="${PUSH_HEAD_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null)}"
  log "commits:    ${TICK_COMMIT_COUNT:-0} new on ${TICK_COMMIT_BRANCH:-$BRANCH}"
  log "goals:      open=${OPEN} in_progress=${INPROG} done=${DONE}"
  case "$PUSH_RESULT" in
    yes)           log "pushed:     yes → origin/$BRANCH" ;;
    rescued)       log "pushed:     RESCUED → origin/$BRANCH (HEAD drifted to '${PUSH_HEAD_BRANCH}', refspec push saved commits)" ;;
    aborted:drift) log "pushed:     ABORTED — HEAD drifted to '${PUSH_HEAD_BRANCH}' and is not fast-forward of origin/$BRANCH" ;;
    failed)        log "pushed:     FAILED — see WARN above" ;;
    disabled)      log "pushed:     no (AGENT_AUTO_PUSH=false)" ;;
    *)             log "pushed:     unknown state: $PUSH_RESULT" ;;
  esac
  log "next tick:  in ${INTERVAL_MINUTES} minutes"

  log "==================== TICK #${tick_number} END   ===================="

  # Interval source resolution.
  #
  # Precedence (inverted from earlier versions — env var is now the default):
  #   1. AUTOPILOT_INTERVAL_MINUTES env var (from docker-compose)  ← source of truth
  #   2. .agent/INTERVAL file                                      ← opt-in override only
  #
  # The .agent/INTERVAL file is ONLY honored when AUTOPILOT_HONOR_INTERVAL_FILE=true.
  # This prevents silent overrides from a stale committed file (the
  # .agent/INTERVAL=15 from commit 8e2b5ff silently beat every env-var change
  # for hours — every tick now logs LOUDLY which source is in effect).
  ENV_INTERVAL="${AUTOPILOT_INTERVAL_MINUTES:-60}"
  HONOR_FILE="${AUTOPILOT_HONOR_INTERVAL_FILE:-false}"
  RESOLVED_INTERVAL="$ENV_INTERVAL"
  INTERVAL_SOURCE="env:AUTOPILOT_INTERVAL_MINUTES"
  if [ -f ".agent/INTERVAL" ]; then
    FILE_INTERVAL=$(cat ".agent/INTERVAL" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$FILE_INTERVAL" ] && [ "$FILE_INTERVAL" -gt 0 ] 2>/dev/null; then
      if [ "$HONOR_FILE" = "true" ]; then
        RESOLVED_INTERVAL="$FILE_INTERVAL"
        INTERVAL_SOURCE="file:.agent/INTERVAL"
        log "interval: using FILE override .agent/INTERVAL=${FILE_INTERVAL}m (env=${ENV_INTERVAL}m, honor_file=true)"
      else
        if [ "$FILE_INTERVAL" != "$ENV_INTERVAL" ]; then
          log "interval: IGNORING .agent/INTERVAL=${FILE_INTERVAL}m (env=${ENV_INTERVAL}m wins, set AUTOPILOT_HONOR_INTERVAL_FILE=true to honor file)"
        else
          log "interval: env=${ENV_INTERVAL}m (file=${FILE_INTERVAL}m in sync, not honored)"
        fi
      fi
    fi
  else
    log "interval: env=${ENV_INTERVAL}m (no file)"
  fi
  INTERVAL_MINUTES="$RESOLVED_INTERVAL"
  log "interval: next tick sleep = ${INTERVAL_MINUTES}m (source=${INTERVAL_SOURCE})"
  sleep "$((INTERVAL_MINUTES * 60))"
done
