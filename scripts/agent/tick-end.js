#!/usr/bin/env node
/**
 * Regenerate .agent/state.json from the live project state.
 * Usage: node scripts/agent/tick-end.js [--tag=<label>]
 *
 * If AGENT_SYNC=true is set, also mirror to DynamoDB (stubbed for Phase 2).
 */
import { loadGoals, countByStatus } from '../../src/agent/goals.js';
import { loadState, saveState, applyPatch } from '../../src/agent/state.js';
import { countTests, countTestFiles, readCoveragePct, srcSizeKb } from '../../src/agent/metrics.js';

const tag = (process.argv.find((a) => a.startsWith('--tag=')) ?? '').split('=')[1];

const goals = await loadGoals();
const counts = countByStatus(goals);
const inProg = goals.find((g) => g.status === 'in_progress');

const [testCount, testFileCount, coveragePct, bundleSizeKb] = await Promise.all([
  countTests(),
  countTestFiles(),
  readCoveragePct(),
  srcSizeKb(),
]);

let prev;
try {
  prev = await loadState();
} catch {
  prev = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    sessionCount: 0,
    lastSessionAt: new Date().toISOString(),
    openGoals: 0,
    inProgressGoals: 0,
    doneGoals: 0,
    blockedGoals: 0,
    currentGoalId: null,
    testCount: 0,
    testFileCount: 0,
    coveragePct: 0,
    lintWarnings: 0,
    bundleSizeKb: null,
    streakDays: 0,
  };
}

const next = applyPatch(prev, {
  sessionCount: prev.sessionCount + 1,
  lastSessionAt: new Date().toISOString(),
  lastSessionTag: tag,
  openGoals: counts.open,
  inProgressGoals: counts.in_progress,
  doneGoals: counts.done,
  blockedGoals: counts.blocked,
  currentGoalId: inProg?.id ?? null,
  testCount,
  testFileCount,
  coveragePct: coveragePct ?? prev.coveragePct,
  bundleSizeKb,
});

await saveState(next);

console.log('=== agent tick-end ===');
console.log(`session: #${next.sessionCount}  tag: ${tag ?? '(none)'}`);
console.log(`goals:   open=${counts.open} in_progress=${counts.in_progress} done=${counts.done}`);
console.log(
  `metrics: tests=${testCount} (${testFileCount} files) coverage=${coveragePct ?? '?'}% src=${bundleSizeKb}KB`,
);

if (process.env.AGENT_SYNC === 'true') {
  console.log('sync:    AGENT_SYNC=true detected, but DDB mirror not yet deployed (Phase 2)');
}
