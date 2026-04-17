# x402 Autopilot — Docker (Local, Pro-plan-powered)

A long-running Docker container that ticks the agent loop **every hour** using
Claude Code CLI authenticated against your **Claude Pro/Max subscription** —
no API key, no token billing, no cloud costs.

## How it works

```
┌────────────────────────────────────────────────────┐
│  x402-autopilot container                          │
│                                                    │
│   while true:                                      │
│     git checkout autopilot && git pull             │
│     npm run agent:start                            │
│     lint + test gate (skip tick if red)            │
│     claude --print "$(cat .agent/CLAUDE_LOOP.md)"  │
│     lint + test gate (revert if red)               │
│     npm run agent:end                              │
│     git commit (state snapshot)                    │
│     sleep 1h                                       │
│                                                    │
└────────────────────────────────────────────────────┘
         ▲                            ▼
     ~/.claude                 ./  (your repo)
    (read-only)               bind mount
```

Between ticks the container sits idle at ~0% CPU.

## Prerequisites

1. **Docker Desktop** running on your host.
2. **Claude Code CLI** installed and logged in on your host, so
   `~/.claude/` contains your credentials. Verify with:
   ```bash
   ls ~/.claude
   claude --version
   ```
3. The `autopilot` branch exists locally (created automatically on first tick
   if missing).

## Start it

```bash
# From the repo root (/path/to/x402):
docker compose -f docker-compose.autopilot.yml up -d --build

# Tail the loop:
docker compose -f docker-compose.autopilot.yml logs -f

# One-shot status:
docker compose -f docker-compose.autopilot.yml ps
```

First boot builds the image (~2 min) and runs `npm ci` inside the container.
The first tick fires immediately, then every hour after.

## Stop it

```bash
# Graceful stop (container waits out current tick or gets SIGTERM'd):
docker compose -f docker-compose.autopilot.yml stop

# Stop + remove container:
docker compose -f docker-compose.autopilot.yml down

# Nuclear option:
docker kill x402-autopilot
```

## Watch what it did

```bash
# Per-tick Claude output:
cat .agent/last-tick.log

# Commit history on autopilot branch:
git log autopilot --oneline -20

# Latest state snapshot:
cat .agent/state.json

# Goal progress:
grep -c '| open ' GOALS.md
grep -c '| done ' GOALS.md
```

## Config knobs (edit `docker-compose.autopilot.yml`)

| Env var                    | Default           | Purpose                                          |
| -------------------------- | ----------------- | ------------------------------------------------ |
| `AUTOPILOT_INTERVAL_HOURS` | `1`               | Seconds between ticks = var × 3600               |
| `AUTOPILOT_MAX_MINUTES`    | `15`              | Hard `timeout` on each `claude` call             |
| `AUTOPILOT_BRANCH`         | `autopilot`       | Long-lived branch, never `main`                  |
| `AUTOPILOT_MODEL`          | `claude-opus-4-6` | Model Claude Code uses                           |
| `AGENT_AUTO_PUSH`          | `false`           | If `true`, `git push origin autopilot` each tick |

## Safety model

1. **Branch isolation** — loop checks out `autopilot` on every tick. It will
   never commit to `main`.
2. **Pre-tick gate** — if lint/tests are red before Claude runs, the tick is
   skipped.
3. **Post-tick gate** — if lint/tests go red after Claude runs, uncommitted
   changes are reverted. (Committed changes remain for your review —
   `git revert <sha>` to undo.)
4. **Push gate** — `AGENT_AUTO_PUSH=false` by default, so commits stay local
   until you push manually.
5. **Timeout** — `claude` is wrapped in `timeout 15m`, so a runaway tick
   cannot burn indefinitely.
6. **Resource caps** — compose limits container to 2 CPU / 2GB RAM.
7. **Credentials read-only** — `~/.claude` is mounted read-only; the
   container cannot mutate your host auth.

## Reviewing autopilot work

```bash
# See what's new on autopilot vs main:
git log main..autopilot --oneline

# Diff a single tick:
git show <sha>

# Revert a bad tick:
git revert <sha>

# When you're happy with progress, merge into main:
git checkout main
git merge --no-ff autopilot
```

## Troubleshooting

**"claude: command not found" in logs** → the global `npm install -g @anthropic-ai/claude-code` failed at build time; rebuild with `--no-cache`.

**"auth required" / Claude can't log in** → your host `~/.claude` wasn't mounted, or the CLI version in the container expects newer creds. Log in fresh on host: `claude login`, then restart the container.

**Tick log shows `post-tick red: reverting`** → Claude introduced a breaking change. Check `.agent/last-tick.log` to see what it tried. This is the safety net working.

**Every tick skips with "pre-tick lint is red"** → fix lint on your side, commit to `autopilot`, restart the container.

**Files committed as root** → your host UID/GID != 1000. Set `UID` and `GID` env vars before `docker compose build`.

## Turning it off for good

```bash
docker compose -f docker-compose.autopilot.yml down --rmi local
git checkout main
```
