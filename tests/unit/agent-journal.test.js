import { describe, it, expect } from 'vitest';
import { renderEntry } from '../../src/agent/journal.js';

describe('agent/journal', () => {
  it('renders a full entry with all sections', () => {
    const out = renderEntry({
      session: 7,
      date: '2026-04-06',
      tag: 'tests',
      goalId: 'G-006',
      goalTitle: 'x402 middleware tests',
      outcome: 'closed',
      filesChanged: 3,
      testsBefore: 8,
      testsAfter: 15,
      coverageBefore: 19,
      coverageAfter: 34,
      lint: 'clean',
      cdk: 'skipped',
      learning: 'vi.mock the config module once at top-level, not per-test.',
      followups: ['G-018', 'G-019'],
      nextSuggested: 'G-007 — auth middleware tests',
    });
    expect(out).toContain('## Session 007 — 2026-04-06 — tests');
    expect(out).toContain('**Goal worked**: G-006 (x402 middleware tests)');
    expect(out).toContain('8 before → 15 after');
    expect(out).toContain('coverage 19% → 34%');
    expect(out).toContain('G-018, G-019');
  });

  it('handles missing coverage gracefully', () => {
    const out = renderEntry({
      session: 1,
      date: '2026-04-05',
      tag: 'x',
      goalId: 'G-000',
      goalTitle: 't',
      outcome: 'closed',
      filesChanged: 1,
      testsBefore: 0,
      testsAfter: 0,
      coverageBefore: null,
      coverageAfter: null,
      lint: 'clean',
      cdk: 'clean',
      learning: 'x',
      followups: [],
    });
    expect(out).toContain('coverage n/a');
    expect(out).toContain('(none)');
  });
});
