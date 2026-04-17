import { describe, it, expect } from 'vitest';
import { countTests, countTestFiles, srcSizeKb, readCoveragePct } from '../../src/agent/metrics.js';

describe('agent/metrics', () => {
  it('countTestFiles > 0 in this repo', async () => {
    const n = await countTestFiles('tests');
    expect(n).toBeGreaterThan(0);
  });

  it('countTests > 0 in this repo', async () => {
    const n = await countTests('tests');
    expect(n).toBeGreaterThan(0);
  });

  it('srcSizeKb > 0', async () => {
    const s = await srcSizeKb('src');
    expect(s).toBeGreaterThan(0);
  });

  it('readCoveragePct returns null when file missing', async () => {
    const pct = await readCoveragePct('does/not/exist.json');
    expect(pct).toBeNull();
  });
});
