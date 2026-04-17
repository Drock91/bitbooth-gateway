# Runbook: Autopilot Stuck — Plateau Halt

> How the supervisor detects stalled progress, why false positives happen,
> and how to resume safely.

## What is a plateau halt?

The autopilot supervisor (`scripts/agent/supervisor.js`) runs after every tick
and decides whether the agent is making real progress or spinning on polish
work. When it detects a stall it writes `.agent/STUCK.md`, which causes the
entrypoint loop to sleep-poll every 15 minutes instead of running ticks.

**Decision signals** (any HARD trigger or >= 2 SOFT triggers = STUCK):

| Type | Signal                                                    | Env var to tune                              |
| ---- | --------------------------------------------------------- | -------------------------------------------- |
| SOFT | Last N completed goals all classify as `polish`           | `SUPERVISOR_WINDOW` (default 5)              |
| SOFT | North star hash unchanged for N ticks                     | `SUPERVISOR_WINDOW`                          |
| SOFT | Coverage >= 90% and delta < 0.5% over N ticks             | `SUPERVISOR_COV_MIN`, `SUPERVISOR_COV_DELTA` |
| HARD | Next open goal is `polish` while `deployed_staging=false` | —                                            |

## The April 11 incident (reference case)

**Commits:** `cc9fc22`, `29c0bdd`, `4f1edfa`, `a5b3f4d`

### Timeline

1. **G-173** shipped the pre-mainnet key flush script — real ship work that
   resolved blocker `G-159` in `NORTH_STAR.blockers[]`.
2. The tick forgot to prune `G-159` from `blockers[]` (step 8b of
   `CLAUDE_LOOP.md` didn't exist yet).
3. `northStarHash()` didn't include `blockers.length` anyway, so even a
   correct prune would have been invisible.
4. Coverage was at 100% — the plateau check fired on `100% → 100%` as a
   false positive (you can't grow past the ceiling).
5. Two SOFT signals fired simultaneously → supervisor declared STUCK at
   tick #2 (`cc9fc22`).
6. The halt blocked **G-174** — the second paid route that would have bumped
   `real_402_issued_count` and `real_usdc_settled_count`. Worst possible
   timing.

### Root causes

| #   | Cause                                                       | Fix in `29c0bdd`                                                                |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | `northStarHash()` ignored `blockers.length` and `doneGoals` | Hash now includes both — resolving a blocker or closing any goal moves the hash |
| 2   | Coverage plateau check had no ceiling guard                 | Skips when `covNow === 100`                                                     |
| 3   | No documented step to prune resolved blockers               | Step 8b added to `CLAUDE_LOOP.md`                                               |

### Contributing factors (same window)

- `4f1edfa` — Container's `~/.claude.json` was corrupted by the host's
  interactive Claude Code session writing at the same instant. Canary
  failed ~1 in 3-5 ticks, burning 30-minute backoff pauses and delaying
  P0 ship goals. Fixed by copying a read-only host snapshot at boot.
- `a5b3f4d` — Secret-scan regex matched a Base Sepolia tx hash
  (`0x` + 64 hex chars) and a 12-word English description as a BIP39
  mnemonic. Both false positives caused hard reverts of valid work.
  Fixed with context-aware pattern refinements.

## How to diagnose a halt

```bash
# 1. Is the agent halted?
ls -la .agent/STUCK.md

# 2. Read the diagnosis
cat .agent/STUCK.md

# 3. Check supervisor log for the trigger reasons
tail -5 .agent/SUPERVISOR_LOG.jsonl | jq .

# 4. Check north star history for hash changes
tail -10 .agent/NORTH_STAR_HISTORY.jsonl | jq .

# 5. Dry-run the supervisor to see what it would decide now
node scripts/agent/supervisor.js --dry-run --tick=0
```

## How to resume

### Option A: Remove the marker (most common)

```bash
rm .agent/STUCK.md
# The entrypoint rechecks every 15 minutes and will auto-resume.
```

### Option B: Fix the root cause first

1. **If recent goals are all polish** — seed ship goals in `GOALS.md`
   (deploy, smoke test, new paid route, etc.) so the next pick is `ship`
   or `unblock` category.
2. **If north star hash is stale** — check `NORTH_STAR.json`:
   - Are there resolved blockers still in `blockers[]`? Prune them and
     add to `blockers_resolved[]`.
   - Are counters stuck? The next goal should bump
     `real_402_issued_count` or `real_usdc_settled_count`.
3. **If coverage plateau** — this is expected at 100%. The fix in
   `29c0bdd` guards against it, but if `SUPERVISOR_COV_MIN` was changed
   below 100, a legitimate plateau at e.g. 95% may re-trigger. Either
   push coverage higher or seed non-polish goals.

After fixing, remove the marker:

```bash
rm .agent/STUCK.md
```

### Option C: Force override (not recommended)

```bash
# Tell the supervisor to report healthy regardless of signals
node scripts/agent/supervisor.js --force-healthy --tick=0
rm .agent/STUCK.md
```

## Goal classification reference

The supervisor classifies goals by keyword matching on the title. If a
goal is misclassified, reword its title in `GOALS.md`.

| Category  | Keywords (partial list)                                     | Effect                    |
| --------- | ----------------------------------------------------------- | ------------------------- |
| `ship`    | deploy, go-live, real 402, real usdc, demo, staging, prod   | Resets plateau window     |
| `unblock` | missing secret, fix broken build, blocker, credentials      | Resets plateau window     |
| `harden`  | security, rate-limit, waf, circuit-break, fraud, pitr       | Resets plateau window     |
| `polish`  | coverage, tests, lint, prettier, refactor, changelog, jsdoc | Increments polish counter |

## Prevention checklist

- [ ] After closing a goal that resolves a `NORTH_STAR.blockers[]` entry,
      prune it and add to `blockers_resolved[]` (CLAUDE_LOOP.md step 8b)
- [ ] When coverage reaches 100%, verify `SUPERVISOR_COV_MIN` < 100 guard
      is active (it is since `29c0bdd`)
- [ ] Keep at least 2–3 `ship`/`unblock`/`harden` goals in the open backlog
      so the agent doesn't exhaust them and trigger the all-polish signal
- [ ] If manually editing `NORTH_STAR.json`, bump `last_updated`

## Key files

| File                              | Purpose                                      |
| --------------------------------- | -------------------------------------------- |
| `scripts/agent/supervisor.js`     | Decision logic, hash function, STUCK report  |
| `docker/autopilot-entrypoint.sh`  | Tick loop, STUCK check, auto-recovery        |
| `.agent/NORTH_STAR.json`          | North star state (counters, blockers, flags) |
| `.agent/NORTH_STAR_HISTORY.jsonl` | Per-tick snapshots for plateau detection     |
| `.agent/SUPERVISOR_LOG.jsonl`     | Decision audit log                           |
| `.agent/STUCK.md`                 | Halt marker (presence = halted)              |
| `.agent/CLAUDE_LOOP.md`           | Agent instructions including step 8b         |
