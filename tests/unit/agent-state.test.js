import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

const { readFile, writeFile, mkdir } = await import('node:fs/promises');
const { loadState, saveState, applyPatch } = await import('../../src/agent/state.js');

const SAMPLE_STATE = {
  schemaVersion: 1,
  updatedAt: '2026-04-06T00:00:00.000Z',
  sessionCount: 10,
  lastSessionAt: '2026-04-06T00:00:00.000Z',
  lastSessionTag: 'tick-1',
  openGoals: 3,
  inProgressGoals: 1,
  doneGoals: 20,
  blockedGoals: 0,
  currentGoalId: 'G-044',
  testCount: 500,
  testFileCount: 30,
  coveragePct: 75.5,
  lintWarnings: 0,
  bundleSizeKb: 80,
  streakDays: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// --- loadState ---

describe('loadState', () => {
  it('reads and parses state from default path', async () => {
    readFile.mockResolvedValue(JSON.stringify(SAMPLE_STATE));
    const state = await loadState();
    expect(readFile).toHaveBeenCalledWith(path.resolve('.agent/state.json'), 'utf8');
    expect(state).toEqual(SAMPLE_STATE);
  });

  it('reads from a custom path', async () => {
    readFile.mockResolvedValue(JSON.stringify(SAMPLE_STATE));
    const state = await loadState('/tmp/custom.json');
    expect(readFile).toHaveBeenCalledWith(path.resolve('/tmp/custom.json'), 'utf8');
    expect(state).toEqual(SAMPLE_STATE);
  });

  it('throws when file does not exist', async () => {
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    readFile.mockRejectedValue(err);
    await expect(loadState()).rejects.toThrow('ENOENT');
  });

  it('throws on invalid JSON', async () => {
    readFile.mockResolvedValue('not valid json {{{');
    await expect(loadState()).rejects.toThrow();
  });

  it('throws on empty file content', async () => {
    readFile.mockResolvedValue('');
    await expect(loadState()).rejects.toThrow();
  });

  it('parses state with null optional fields', async () => {
    const withNulls = { ...SAMPLE_STATE, currentGoalId: null, bundleSizeKb: null };
    readFile.mockResolvedValue(JSON.stringify(withNulls));
    const state = await loadState();
    expect(state.currentGoalId).toBeNull();
    expect(state.bundleSizeKb).toBeNull();
  });

  it('parses state without optional lastSessionTag', async () => {
    const { lastSessionTag: _, ...noTag } = SAMPLE_STATE;
    readFile.mockResolvedValue(JSON.stringify(noTag));
    const state = await loadState();
    expect(state.lastSessionTag).toBeUndefined();
  });
});

// --- saveState ---

describe('saveState', () => {
  it('writes formatted JSON to default path', async () => {
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);

    await saveState(SAMPLE_STATE);

    const expectedPath = path.resolve('.agent/state.json');
    expect(mkdir).toHaveBeenCalledWith(path.dirname(expectedPath), { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      expectedPath,
      JSON.stringify(SAMPLE_STATE, null, 2) + '\n',
      'utf8',
    );
  });

  it('writes to a custom path', async () => {
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);

    await saveState(SAMPLE_STATE, '/tmp/deep/nested/state.json');

    const expectedPath = path.resolve('/tmp/deep/nested/state.json');
    expect(mkdir).toHaveBeenCalledWith(path.dirname(expectedPath), { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      expectedPath,
      JSON.stringify(SAMPLE_STATE, null, 2) + '\n',
      'utf8',
    );
  });

  it('creates parent directories recursively', async () => {
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);

    await saveState(SAMPLE_STATE, 'a/b/c/state.json');

    expect(mkdir).toHaveBeenCalledWith(path.dirname(path.resolve('a/b/c/state.json')), {
      recursive: true,
    });
  });

  it('propagates mkdir errors', async () => {
    mkdir.mockRejectedValue(new Error('EACCES'));
    await expect(saveState(SAMPLE_STATE)).rejects.toThrow('EACCES');
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('propagates writeFile errors', async () => {
    mkdir.mockResolvedValue(undefined);
    writeFile.mockRejectedValue(new Error('ENOSPC'));
    await expect(saveState(SAMPLE_STATE)).rejects.toThrow('ENOSPC');
  });

  it('output ends with a trailing newline', async () => {
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);

    await saveState(SAMPLE_STATE);

    const written = writeFile.mock.calls[0][1];
    expect(written.endsWith('\n')).toBe(true);
  });

  it('output is valid JSON (minus trailing newline)', async () => {
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);

    await saveState(SAMPLE_STATE);

    const written = writeFile.mock.calls[0][1];
    const parsed = JSON.parse(written.trimEnd());
    expect(parsed).toEqual(SAMPLE_STATE);
  });

  it('uses 2-space indentation', async () => {
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);

    await saveState({ schemaVersion: 1, updatedAt: 'x' });

    const written = writeFile.mock.calls[0][1];
    expect(written).toContain('  "schemaVersion"');
  });
});

// --- applyPatch ---

describe('applyPatch', () => {
  it('merges patch fields into prev state', () => {
    const result = applyPatch(SAMPLE_STATE, { sessionCount: 11 });
    expect(result.sessionCount).toBe(11);
    expect(result.schemaVersion).toBe(1);
  });

  it('stamps updatedAt with current ISO timestamp', () => {
    const before = new Date().toISOString();
    const result = applyPatch(SAMPLE_STATE, { sessionCount: 11 });
    const after = new Date().toISOString();
    expect(result.updatedAt >= before).toBe(true);
    expect(result.updatedAt <= after).toBe(true);
  });

  it('overrides an explicit updatedAt in the patch', () => {
    const result = applyPatch(SAMPLE_STATE, { updatedAt: '1999-01-01T00:00:00.000Z' });
    expect(result.updatedAt).not.toBe('1999-01-01T00:00:00.000Z');
    expect(result.updatedAt > '2026-01-01').toBe(true);
  });

  it('does not mutate the previous state object', () => {
    const prev = { ...SAMPLE_STATE };
    const originalUpdatedAt = prev.updatedAt;
    applyPatch(prev, { sessionCount: 999 });
    expect(prev.sessionCount).toBe(SAMPLE_STATE.sessionCount);
    expect(prev.updatedAt).toBe(originalUpdatedAt);
  });

  it('does not mutate the patch object', () => {
    const patch = { sessionCount: 42 };
    applyPatch(SAMPLE_STATE, patch);
    expect(patch).toEqual({ sessionCount: 42 });
  });

  it('returns all fields from prev when patch is empty', () => {
    const result = applyPatch(SAMPLE_STATE, {});
    expect(result.schemaVersion).toBe(SAMPLE_STATE.schemaVersion);
    expect(result.sessionCount).toBe(SAMPLE_STATE.sessionCount);
    expect(result.testCount).toBe(SAMPLE_STATE.testCount);
  });

  it('can set currentGoalId to null', () => {
    const withGoal = { ...SAMPLE_STATE, currentGoalId: 'G-044' };
    const result = applyPatch(withGoal, { currentGoalId: null });
    expect(result.currentGoalId).toBeNull();
  });

  it('can update multiple fields at once', () => {
    const result = applyPatch(SAMPLE_STATE, {
      openGoals: 0,
      doneGoals: 24,
      currentGoalId: null,
      streakDays: 6,
    });
    expect(result.openGoals).toBe(0);
    expect(result.doneGoals).toBe(24);
    expect(result.currentGoalId).toBeNull();
    expect(result.streakDays).toBe(6);
  });

  it('preserves fields not in the patch', () => {
    const result = applyPatch(SAMPLE_STATE, { testCount: 600 });
    expect(result.coveragePct).toBe(SAMPLE_STATE.coveragePct);
    expect(result.lintWarnings).toBe(SAMPLE_STATE.lintWarnings);
    expect(result.bundleSizeKb).toBe(SAMPLE_STATE.bundleSizeKb);
  });
});
