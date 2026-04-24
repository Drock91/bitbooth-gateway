#!/usr/bin/env node
/**
 * Print orientation context at the start of an agent tick.
 * Usage: node scripts/agent/tick-start.js
 */
import { loadGoals, pickNext, countByStatus } from '../../src/agent/goals.js';
import { loadState } from '../../src/agent/state.js';
import { readCoveragePct, countTests } from '../../src/agent/metrics.js';

const goals = await loadGoals();
const counts = countByStatus(goals);
// Budget is "max estimate for a pickable goal" — NOT a per-tick time cap.
// The tick itself is capped by AUTOPILOT_MAX_MINUTES (default 25) via timeout,
// and large goals are expected to span multiple ticks. Hardcoding 60 meant
// every P0/P1 goal >60m (like G-013 240m, G-050 480m) was invisible to the
// picker even when it was the highest-priority open work — the picker would
// fall through to tiny P2 polish goals, which re-tripped the supervisor's
// polish-window detector. Raising to 480 lets big harden/ship work drive
// ticks; supervisor still enforces ship-vs-polish hygiene on completions.
const next = pickNext(goals, 480);

let state = null;
try {
  state = await loadState();
} catch {
  /* first run */
}

const [liveCoverage, liveTests] = await Promise.all([readCoveragePct(), countTests()]);

console.log('=== agent tick-start ===');
console.log(`session: #${(state?.sessionCount ?? 0) + 1}`);
console.log(
  `goals:   open=${counts.open} in_progress=${counts.in_progress} done=${counts.done} blocked=${counts.blocked}`,
);
console.log(
  `metrics: tests=${liveTests ?? state?.testCount ?? '?'} coverage=${liveCoverage ?? state?.coveragePct ?? '?'}% lint-warn=${state?.lintWarnings ?? '?'}`,
);
console.log('');
if (next) {
  console.log(`pick:    ${next.id} [${next.priority}] (${next.estimateMinutes}m) ${next.title}`);
} else {
  console.log('pick:    (no goal in budget — consider idle tick)');
}
console.log('');
console.log('read:    GOALS.md  MEMORY.md (last 3)  .agent/CLAUDE_LOOP.md');
