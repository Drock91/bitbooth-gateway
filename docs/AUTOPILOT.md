# Autopilot — How to run x402 on cruise control

Two autopilot loops are wired. Use either or both.

## Loop A — Cowork scheduled task (local, free)

Runs on your machine whenever Cowork is open. Good for laptop-open hours.

- Schedule: hourly (configurable)
- Model: whatever Cowork is using (Opus 4.6)
- Branch: commits to local `autopilot` branch; you push/merge manually

Create it with `/schedule` or the task I provisioned ("x402-autopilot-tick").

## Loop B — GitHub Actions (cloud, 24/7)

Runs on GitHub's runners. No laptop needed.

- Schedule: every 4 hours (UTC) via `.github/workflows/autopilot.yml`
- Model: `claude-opus-4-6` via Anthropic API
- Branch: commits + pushes to remote `autopilot` branch
- Requires: `ANTHROPIC_API_KEY` repo secret

### Setup

1. Push this repo to GitHub.
2. Create the `autopilot` branch: `git checkout -b autopilot && git push -u origin autopilot`.
3. Add `ANTHROPIC_API_KEY` under Settings → Secrets and variables → Actions.
4. Protect `main` (Settings → Branches → add rule: require PR to merge into main).
5. First run: Actions → autopilot → Run workflow.

### Review workflow

- Open PR from `autopilot` → `main` at any time.
- Review the stacked commits (each is one tick).
- Merge when happy. Don't merge what you don't like.
- Revert a bad tick: `git revert <sha>` on the autopilot branch.

## Branching model

```
main (protected)
 │
 └── autopilot (long-lived; every tick = 1 commit)
      ├── tick: G-006 add x402 middleware tests
      ├── tick: G-007 add auth middleware tests
      ├── tick: G-001 swap XRPL EVM → Base/USDC
      └── ...
```

- **One branch, many commits.** Work accumulates.
- **Commits are checkpoints.** Diff, revert, cherry-pick anywhere.
- **Optional weekly tags**: `snapshot/2026-W15`, `snapshot/2026-W16`, etc.

## Kill switches

- **Disable Loop A**: in Cowork, open the scheduled task and toggle it off.
- **Disable Loop B**: Actions → autopilot → disable workflow.
- **Rollback everything since Monday**: `git checkout autopilot && git reset --hard snapshot/2026-W15 && git push -f origin autopilot` (only if you pushed).

## Budgets

- Per tick: ≤60 min wall-clock, ≤15 min Claude runtime.
- Per day: capped by cron cadence × 15min. 6 ticks = ~90 min compute.
- Token spend: ~$3–8/tick with Opus; ~$0.50–1/tick with Sonnet. Set model in workflow file.
