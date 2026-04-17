import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('../../src/lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { readFileSync, existsSync } from 'node:fs';
import { loadOpenapiYaml, _resetOpenapiCache } from '../../src/lib/load-openapi.js';

describe('load-openapi', () => {
  beforeEach(() => {
    _resetOpenapiCache();
    readFileSync.mockReset();
    existsSync.mockReset();
  });

  it('returns the openapi.yaml contents when found on disk', () => {
    existsSync.mockReturnValueOnce(true);
    readFileSync.mockReturnValueOnce('openapi: 3.0.3\ninfo:\n  title: test\n');
    const yaml = loadOpenapiYaml();
    expect(yaml).toContain('openapi: 3.0.3');
    expect(yaml).toContain('title: test');
  });

  it('caches the result across calls (single fs read)', () => {
    existsSync.mockReturnValueOnce(true);
    readFileSync.mockReturnValueOnce('openapi: 3.0.3');
    loadOpenapiYaml();
    loadOpenapiYaml();
    loadOpenapiYaml();
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });

  it('falls back to stub yaml when no candidate path exists', () => {
    existsSync.mockReturnValue(false);
    const yaml = loadOpenapiYaml();
    expect(yaml).toContain('openapi: 3.0.3');
    expect(yaml).toContain('Obol');
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('falls back to stub yaml when readFileSync throws', () => {
    existsSync.mockReturnValueOnce(true);
    readFileSync.mockImplementationOnce(() => {
      throw new Error('EACCES permission denied');
    });
    const yaml = loadOpenapiYaml();
    expect(yaml).toContain('openapi: 3.0.3');
    expect(yaml).toContain('unavailable');
  });

  it('caches the fallback so repeated calls stay cheap', () => {
    existsSync.mockReturnValue(false);
    loadOpenapiYaml();
    loadOpenapiYaml();
    expect(existsSync).toHaveBeenCalledTimes(5); // once per candidate, first call only
  });

  it('probes multiple candidate paths until one exists', () => {
    existsSync.mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValueOnce(true);
    readFileSync.mockReturnValueOnce('openapi: 3.0.3\npaths: {}');
    const yaml = loadOpenapiYaml();
    expect(yaml).toContain('openapi: 3.0.3');
    expect(existsSync).toHaveBeenCalledTimes(3);
  });

  it('_resetOpenapiCache clears cached value', () => {
    existsSync.mockReturnValueOnce(true);
    readFileSync.mockReturnValueOnce('first');
    expect(loadOpenapiYaml()).toBe('first');

    _resetOpenapiCache();
    existsSync.mockReturnValueOnce(true);
    readFileSync.mockReturnValueOnce('second');
    expect(loadOpenapiYaml()).toBe('second');
  });
});
