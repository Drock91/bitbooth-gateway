import { describe, it, expect } from 'vitest';
import { parseGoals, pickNext, countByStatus, appendGoal } from '../../src/agent/goals.js';

const SAMPLE = `
## Active

| ID | Pri | Status | Est | Title |
|----|-----|--------|-----|-------|
| G-001 | P0 | open | 45m | Swap chain |
| G-002 | P0 | in_progress | 30m | Tenants table |
| G-003 | P1 | open | 30m | Tests |
| G-004 | P1 | open | 120m | Big thing |
| G-005 | P2 | open | 30m | Nice to have |

## Closed

| ID | Pri | Status | Est | Title | Closed |
|----|-----|--------|-----|-------|--------|
| G-000 | P0 | done | 120m | bootstrap | 2026-04-05 |
`;

describe('agent/goals', () => {
  it('parses rows into Goal objects', () => {
    const goals = parseGoals(SAMPLE);
    expect(goals).toHaveLength(6);
    expect(goals[0]).toEqual({
      id: 'G-001',
      priority: 'P0',
      status: 'open',
      estimateMinutes: 45,
      title: 'Swap chain',
      closedAt: undefined,
    });
    const closed = goals.find((g) => g.id === 'G-000');
    expect(closed?.closedAt).toBe('2026-04-05');
  });

  it('pickNext resumes in_progress first', () => {
    const goals = parseGoals(SAMPLE);
    const next = pickNext(goals, 60);
    expect(next?.id).toBe('G-002');
  });

  it('pickNext picks top P0 open within budget when nothing in_progress', () => {
    const goals = parseGoals(SAMPLE).filter((g) => g.status !== 'in_progress');
    const next = pickNext(goals, 60);
    expect(next?.id).toBe('G-001');
  });

  it('pickNext respects budget', () => {
    const goals = parseGoals(SAMPLE).filter((g) => g.status !== 'in_progress');
    const next = pickNext(goals, 20);
    expect(next).toBeNull();
  });

  it('pickNext prefers P0 over P1 over P2', () => {
    const md = `
| ID | Pri | Status | Est | Title |
| G-010 | P2 | open | 10m | low |
| G-011 | P1 | open | 10m | mid |
`;
    const goals = parseGoals(md);
    expect(pickNext(goals, 60)?.id).toBe('G-011');
  });

  it('pickNext picks P0 even when P2 appears first in file order', () => {
    const md = `
| ID | Pri | Status | Est | Title |
| G-050 | P2 | open | 30m | Polish |
| G-051 | P2 | open | 30m | More polish |
| G-049 | P0 | open | 45m | Ship blocker |
`;
    const goals = parseGoals(md);
    expect(pickNext(goals, 60)?.id).toBe('G-049');
  });

  it('pickNext uses ID as tiebreaker within same priority', () => {
    const md = `
| ID | Pri | Status | Est | Title |
| G-020 | P1 | open | 30m | Second |
| G-010 | P1 | open | 30m | First |
`;
    const goals = parseGoals(md);
    expect(pickNext(goals, 60)?.id).toBe('G-010');
  });

  it('countByStatus totals correctly', () => {
    const counts = countByStatus(parseGoals(SAMPLE));
    expect(counts.open).toBe(4);
    expect(counts.in_progress).toBe(1);
    expect(counts.done).toBe(1);
    expect(counts.blocked).toBe(0);
  });

  it('appendGoal inserts row into Active section', () => {
    const md = `# Goals\n\n## Active\n\n| ID | Pri | Status | Est | Title |\n|----|-----|--------|-----|-------|\n| G-001 | P0 | open | 30m | Existing |\n\n## Closed\n\n| x |\n`;
    const out = appendGoal(md, {
      id: 'G-002',
      priority: 'P1',
      status: 'open',
      estimateMinutes: 45,
      title: 'New goal',
    });
    expect(out).toContain('| G-002 | P1 | open | 45m | New goal |');
    expect(out.indexOf('G-002')).toBeGreaterThan(out.indexOf('G-001'));
    expect(out.indexOf('G-002')).toBeLessThan(out.indexOf('## Closed'));
  });
});
