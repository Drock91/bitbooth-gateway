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
const next = pickNext(goals, 60);

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
