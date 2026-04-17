import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecSync = vi.fn();

vi.mock('node:child_process', () => ({
  execSync: (...a) => mockExecSync(...a),
}));

let findTsFiles;

beforeEach(async () => {
  vi.resetModules();
  mockExecSync.mockReset();
  ({ findTsFiles } = await import('../../scripts/ts-guard.js'));
});

describe('findTsFiles', () => {
  it('returns empty array when no TS files exist', () => {
    mockExecSync.mockReturnValue('');
    expect(findTsFiles('/fake')).toEqual([]);
  });

  it('returns list of detected .ts files', () => {
    mockExecSync.mockReturnValue('src/index.ts\nsrc/types.ts\n');
    expect(findTsFiles('/fake')).toEqual(['src/index.ts', 'src/types.ts']);
  });

  it('returns list of detected .tsx files', () => {
    mockExecSync.mockReturnValue('src/App.tsx\n');
    expect(findTsFiles('/fake')).toEqual(['src/App.tsx']);
  });

  it('returns tsconfig files', () => {
    mockExecSync.mockReturnValue('tsconfig.json\ntsconfig.build.json\n');
    expect(findTsFiles('/fake')).toEqual(['tsconfig.json', 'tsconfig.build.json']);
  });

  it('returns mixed TS file types', () => {
    mockExecSync.mockReturnValue('tsconfig.json\nsrc/a.ts\nsrc/b.tsx\n');
    const result = findTsFiles('/fake');
    expect(result).toHaveLength(3);
    expect(result).toContain('tsconfig.json');
    expect(result).toContain('src/a.ts');
    expect(result).toContain('src/b.tsx');
  });

  it('passes root dir as cwd to execSync', () => {
    mockExecSync.mockReturnValue('');
    findTsFiles('/my/project');
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cwd: '/my/project' }),
    );
  });

  it('uses git ls-files with correct glob patterns', () => {
    mockExecSync.mockReturnValue('');
    findTsFiles('/fake');
    const cmd = mockExecSync.mock.calls[0][0];
    expect(cmd).toContain('*.ts');
    expect(cmd).toContain('*.tsx');
    expect(cmd).toContain('tsconfig*.json');
  });

  it('returns empty array when execSync throws', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('git not found');
    });
    expect(findTsFiles('/fake')).toEqual([]);
  });

  it('filters out empty strings from output', () => {
    mockExecSync.mockReturnValue('\n\n');
    expect(findTsFiles('/fake')).toEqual([]);
  });

  it('trims whitespace from output', () => {
    mockExecSync.mockReturnValue('  src/index.ts  \n');
    expect(findTsFiles('/fake')).toEqual(['src/index.ts']);
  });
});

describe('module exports', () => {
  it('exports findTsFiles as a function', () => {
    expect(findTsFiles).toBeTypeOf('function');
  });
});
