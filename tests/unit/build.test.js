import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks for node:fs/promises, node:fs, and esbuild — set up BEFORE dynamic import.
const mockRm = vi.fn();
const mockMkdir = vi.fn();
const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockReaddirSync = vi.fn();
const mockStatSync = vi.fn();
const mockEsbuild = vi.fn();

vi.mock('node:fs/promises', () => ({
  rm: (...a) => mockRm(...a),
  mkdir: (...a) => mockMkdir(...a),
  writeFile: (...a) => mockWriteFile(...a),
  readFile: (...a) => mockReadFile(...a),
}));

vi.mock('node:fs', () => ({
  readdirSync: (...a) => mockReaddirSync(...a),
  statSync: (...a) => mockStatSync(...a),
}));

vi.mock('esbuild', () => ({
  default: { build: (...a) => mockEsbuild(...a) },
}));

let exitCode;
let origExit;
let logSpy;
let errorSpy;

function setupDefaults() {
  mockRm.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockReadFile.mockResolvedValue(JSON.stringify({ name: 'x402', version: '1.0.0' }));
  mockReaddirSync.mockReturnValue(['api.handler.js', 'webhook.handler.js', 'README.md']);
  mockEsbuild.mockResolvedValue({ errors: [] });
  mockStatSync.mockReturnValue({ size: 50 * 1024 });
}

let importSeq = 0;
async function runBuild() {
  return import('../../scripts/build.js?v=' + ++importSeq);
}

describe('scripts/build.js', () => {
  beforeEach(() => {
    vi.resetModules();
    exitCode = null;
    origExit = process.exit;
    process.exit = vi.fn((code) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupDefaults();
  });

  afterEach(() => {
    process.exit = origExit;
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('cleans dist/ with recursive + force', async () => {
    await runBuild();
    expect(mockRm).toHaveBeenCalledWith(expect.stringContaining('dist'), {
      recursive: true,
      force: true,
    });
  });

  it('creates dist directory', async () => {
    await runBuild();
    expect(mockMkdir).toHaveBeenCalledWith(expect.stringMatching(/dist$/), { recursive: true });
  });

  it('tolerates rm failure and continues', async () => {
    mockRm.mockRejectedValue(new Error('EPERM'));
    await runBuild();
    expect(mockMkdir).toHaveBeenCalled();
    expect(mockEsbuild).toHaveBeenCalled();
  });

  it('discovers only .handler.js files', async () => {
    await runBuild();
    const entries = mockEsbuild.mock.calls[0][0].entryPoints;
    expect(entries).toHaveLength(2);
    // Entries are `{ in, out }` objects post-flatten.
    expect(entries.every((e) => e.in.endsWith('.handler.js'))).toBe(true);
    // out is the flattened basename, e.g. "api" (no .handler, no extension).
    expect(entries.every((e) => !e.out.includes('.handler'))).toBe(true);
    expect(entries.some((e) => e.in.includes('README.md'))).toBe(false);
  });

  it('exits 1 when no handler entry points found', async () => {
    mockReaddirSync.mockReturnValue(['README.md', 'utils.js']);
    await expect(runBuild()).rejects.toThrow('process.exit(1)');
    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No handler entry points'));
  });

  it('passes correct esbuild config', async () => {
    await runBuild();
    const config = mockEsbuild.mock.calls[0][0];
    expect(config.bundle).toBe(true);
    expect(config.platform).toBe('node');
    expect(config.target).toBe('node20');
    expect(config.format).toBe('esm');
    expect(config.external).toEqual(['@aws-sdk/*', '@sparticuz/chromium', 'playwright-core']);
    expect(config.minify).toBe(true);
    expect(config.treeShaking).toBe(true);
    expect(config.sourcemap).toBe(false);
    // Banner injects the ESM-safe comment + createRequire polyfill for deps
    // that still call `require('node:os')` etc. at runtime.
    expect(config.banner.js).toContain('// Bundled by esbuild');
    expect(config.banner.js).toContain('createRequire');
    expect(config.logLevel).toBe('warning');
  });

  it('sets outdir to dist (flat)', async () => {
    await runBuild();
    const config = mockEsbuild.mock.calls[0][0];
    expect(config.outdir).toMatch(/dist$/);
    expect(config.outdir).not.toMatch(/dist[/\\]handlers$/);
  });

  it('exits 1 when esbuild returns errors', async () => {
    mockEsbuild.mockResolvedValue({
      errors: [{ text: 'Module not found' }],
    });
    await expect(runBuild()).rejects.toThrow('process.exit(1)');
    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[build] esbuild errors:',
      expect.arrayContaining([expect.objectContaining({ text: 'Module not found' })]),
    );
  });

  it('writes minimal package.json to dist/', async () => {
    await runBuild();
    const [outPath, content] = mockWriteFile.mock.calls[0];
    expect(outPath).toMatch(/dist[/\\]package\.json$/);
    const parsed = JSON.parse(content);
    expect(parsed).toEqual({ name: 'x402', version: '1.0.0', type: 'module' });
  });

  it('strips extra fields from package.json', async () => {
    // Default readFile returns {name, version} — verify only name/version/type are written
    await runBuild();
    const content = JSON.parse(mockWriteFile.mock.calls[0][1]);
    expect(Object.keys(content).sort()).toEqual(['name', 'type', 'version']);
  });

  it('reports per-handler sizes and total', async () => {
    mockReaddirSync.mockReturnValue(['api.handler.js']);
    mockStatSync.mockReturnValue({ size: 30 * 1024 });
    await runBuild();
    // Flattened output: dist/api.js (no ".handler" infix).
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\bapi\.js.*30\.0 KB/));
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/total.*30\.0 KB.*1 handler/));
  });

  it('sums sizes across multiple handlers', async () => {
    mockReaddirSync.mockReturnValue(['a.handler.js', 'b.handler.js']);
    mockStatSync.mockReturnValueOnce({ size: 10 * 1024 }).mockReturnValueOnce({ size: 20 * 1024 });
    await runBuild();
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/total.*30\.0 KB.*2 handlers/));
  });

  it('logs "dist/ ready" on success', async () => {
    await runBuild();
    expect(logSpy).toHaveBeenCalledWith('[build] dist/ ready');
  });

  it('reads package.json from project root', async () => {
    await runBuild();
    expect(mockReadFile).toHaveBeenCalledWith(expect.stringMatching(/package\.json$/), 'utf8');
  });
});
