import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFs = {
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
};

vi.mock('node:fs', () => ({
  default: mockFs,
}));

const mockExecSync = vi.fn();
vi.mock('node:child_process', () => ({
  execSync: (...args) => mockExecSync(...args),
}));

let sup;
let stderrWriteSpy;

beforeEach(async () => {
  vi.resetModules();
  for (const fn of Object.values(mockFs)) fn.mockReset();
  mockExecSync.mockReset();
  stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  sup = await import('../../scripts/agent/supervisor.js');
});

afterEach(() => {
  stderrWriteSpy.mockRestore();
  delete process.env.GH_AUTOPILOT_ISSUES;
});

describe('classifyGoal', () => {
  it('returns "unknown" for empty/null titles', () => {
    expect(sup.classifyGoal('')).toBe('unknown');
    expect(sup.classifyGoal(null)).toBe('unknown');
    expect(sup.classifyGoal(undefined)).toBe('unknown');
  });

  it('classifies test/coverage/lint work as polish', () => {
    expect(sup.classifyGoal('Add unit tests for fraud service')).toBe('polish');
    expect(sup.classifyGoal('Cover remaining branch gaps')).toBe('polish');
    expect(sup.classifyGoal('Write integration tests for idempotency')).toBe('polish');
    expect(sup.classifyGoal('Lint rules tightening')).toBe('polish');
    expect(sup.classifyGoal('Prettier format check')).toBe('polish');
    expect(sup.classifyGoal('Refactor local-server.js')).toBe('polish');
    expect(sup.classifyGoal('Update README and CHANGELOG')).toBe('polish');
    expect(sup.classifyGoal('Extract HTML template to separate module')).toBe('polish');
  });

  it('classifies deploy/live work as ship', () => {
    expect(sup.classifyGoal('cdk deploy staging')).toBe('ship');
    expect(sup.classifyGoal('Ship to prod endpoint')).toBe('ship');
    expect(sup.classifyGoal('First deploy of API gateway')).toBe('ship');
    expect(sup.classifyGoal('Deploy Base Sepolia RPC URL to staging')).toBe('ship');
    expect(sup.classifyGoal('Real 402 issuance on live URL')).toBe('ship');
    expect(sup.classifyGoal('Demo ready endpoint for Kevin')).toBe('ship');
    expect(sup.classifyGoal('Live test of endpoint')).toBe('ship');
    expect(sup.classifyGoal('Bootstrap AWS account')).toBe('ship');
  });

  it('classifies blocker removal as unblock', () => {
    expect(sup.classifyGoal('Missing Stripe webhook secret')).toBe('unblock');
    expect(sup.classifyGoal('Fix broken build on CI')).toBe('unblock');
    expect(sup.classifyGoal('Unblock payment flow')).toBe('unblock');
    expect(sup.classifyGoal('Blocker: admin API key hash')).toBe('unblock');
    expect(sup.classifyGoal('Credentials not configured')).toBe('unblock');
    expect(sup.classifyGoal('Connect AWS credentials')).toBe('unblock');
  });

  it('classifies reliability/security hardening as harden', () => {
    expect(sup.classifyGoal('Add rate limit to signup')).toBe('harden');
    expect(sup.classifyGoal('Security audit of x402')).toBe('harden');
    expect(sup.classifyGoal('WAF rules for gateway')).toBe('harden');
    expect(sup.classifyGoal('Secret rotation script')).toBe('harden');
    expect(sup.classifyGoal('Incident response runbook')).toBe('harden');
    expect(sup.classifyGoal('Circuit-break pattern for RPC')).toBe('harden');
    expect(sup.classifyGoal('Idempotency middleware cache policy')).toBe('harden');
    expect(sup.classifyGoal('Fraud detection velocity')).toBe('harden');
    expect(sup.classifyGoal('Enable point-in-time recovery')).toBe('harden');
    expect(sup.classifyGoal('Backup and recover plan')).toBe('harden');
  });

  it('prioritizes polish over harden when both keywords appear', () => {
    expect(sup.classifyGoal('Add tests for fraud service')).toBe('polish');
    expect(sup.classifyGoal('Write unit tests for idempotency middleware')).toBe('polish');
    expect(sup.classifyGoal('Cover branch gap in rate-limit middleware')).toBe('polish');
  });

  it('defaults to polish for unmatched titles', () => {
    expect(sup.classifyGoal('Some random thing')).toBe('polish');
  });
});

describe('parseArgs', () => {
  it('returns defaults when no args passed', () => {
    expect(sup.parseArgs([])).toEqual({ tick: 0, dryRun: false, force: null });
  });

  it('parses --tick=N', () => {
    expect(sup.parseArgs(['--tick=42'])).toEqual({ tick: 42, dryRun: false, force: null });
  });

  it('treats non-numeric tick as 0', () => {
    expect(sup.parseArgs(['--tick=abc'])).toEqual({ tick: 0, dryRun: false, force: null });
  });

  it('parses --dry-run', () => {
    expect(sup.parseArgs(['--dry-run'])).toMatchObject({ dryRun: true });
  });

  it('parses --force-stuck and --force-healthy', () => {
    expect(sup.parseArgs(['--force-stuck'])).toMatchObject({ force: 'stuck' });
    expect(sup.parseArgs(['--force-healthy'])).toMatchObject({ force: 'healthy' });
  });

  it('ignores unknown args', () => {
    expect(sup.parseArgs(['--nonsense', '--tick=7'])).toEqual({
      tick: 7,
      dryRun: false,
      force: null,
    });
  });

  it('defaults argv from process.argv when called without args', () => {
    const origArgv = process.argv;
    process.argv = ['node', 'supervisor.js', '--tick=5', '--dry-run'];
    try {
      expect(sup.parseArgs()).toEqual({ tick: 5, dryRun: true, force: null });
    } finally {
      process.argv = origArgv;
    }
  });
});

describe('northStarHash', () => {
  const baseNs = {
    deployed_staging: false,
    deployed_prod: false,
    staging_url: null,
    prod_url: null,
    real_402_issued_count: 0,
    real_usdc_settled_count: 0,
    first_real_tenant: false,
    demo_ready: false,
    blockers: [],
  };

  it('is deterministic for identical inputs', () => {
    const h1 = sup.northStarHash(baseNs, { doneGoals: 10 });
    const h2 = sup.northStarHash(baseNs, { doneGoals: 10 });
    expect(h1).toBe(h2);
  });

  it('changes when deployed_staging flips', () => {
    const h1 = sup.northStarHash(baseNs, {});
    const h2 = sup.northStarHash({ ...baseNs, deployed_staging: true }, {});
    expect(h1).not.toBe(h2);
  });

  it('changes when blocker count changes', () => {
    const h1 = sup.northStarHash({ ...baseNs, blockers: ['G-100'] }, {});
    const h2 = sup.northStarHash({ ...baseNs, blockers: [] }, {});
    expect(h1).not.toBe(h2);
  });

  it('changes when real_402 counter increments', () => {
    const h1 = sup.northStarHash(baseNs, {});
    const h2 = sup.northStarHash({ ...baseNs, real_402_issued_count: 1 }, {});
    expect(h1).not.toBe(h2);
  });

  it('treats missing blockers[] as count 0', () => {
    const { blockers: _b, ...noBlockers } = baseNs;
    const h1 = sup.northStarHash(noBlockers, {});
    const h2 = sup.northStarHash(baseNs, {});
    expect(h1).toBe(h2);
  });

  it('includes doneGoals from state', () => {
    const h1 = sup.northStarHash(baseNs, { doneGoals: 100 });
    const h2 = sup.northStarHash(baseNs, { doneGoals: 101 });
    expect(h1).not.toBe(h2);
  });

  it('treats undefined state as doneGoals=0', () => {
    const h1 = sup.northStarHash(baseNs, {});
    const h2 = sup.northStarHash(baseNs, undefined);
    expect(h1).toBe(h2);
  });
});

describe('readJson', () => {
  it('parses JSON file contents', () => {
    mockFs.readFileSync.mockReturnValue('{"a":1}');
    expect(sup.readJson('/x', { fallback: true })).toEqual({ a: 1 });
  });

  it('returns fallback on read error', () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(sup.readJson('/x', { fallback: true })).toEqual({ fallback: true });
  });

  it('returns fallback on malformed JSON', () => {
    mockFs.readFileSync.mockReturnValue('not json');
    expect(sup.readJson('/x', null)).toBeNull();
  });
});

describe('readJsonl', () => {
  it('parses each non-empty line', () => {
    mockFs.readFileSync.mockReturnValue('{"a":1}\n{"b":2}\n');
    expect(sup.readJsonl('/x')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('filters out empty lines and malformed lines', () => {
    mockFs.readFileSync.mockReturnValue('{"a":1}\n\nnot-json\n{"b":2}');
    expect(sup.readJsonl('/x')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('returns [] when file missing', () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(sup.readJsonl('/x')).toEqual([]);
  });
});

describe('appendJsonl', () => {
  it('mkdirs parent and appends one JSON line', () => {
    sup.appendJsonl('/tmp/agent/SUPERVISOR_LOG.jsonl', { tick: 1 });
    expect(mockFs.mkdirSync).toHaveBeenCalledWith('/tmp/agent', { recursive: true });
    expect(mockFs.appendFileSync).toHaveBeenCalledWith(
      '/tmp/agent/SUPERVISOR_LOG.jsonl',
      '{"tick":1}\n',
    );
  });
});

describe('recentDoneGoals', () => {
  it('returns last N done rows parsed from GOALS.md', () => {
    const md = [
      '# Goals',
      '| G-001 | P0 | done | 30m | First goal |',
      '| G-002 | P1 | open | 30m | Still open |',
      '| G-003 | P1 | done | 30m | Second done |',
      '| G-004 | P2 | done | 30m | Third done |',
      '',
    ].join('\n');
    mockFs.readFileSync.mockReturnValue(md);
    const out = sup.recentDoneGoals(2);
    expect(out).toEqual([
      { id: 'G-003', title: 'Second done' },
      { id: 'G-004', title: 'Third done' },
    ]);
  });

  it('returns fewer than N if not enough done rows', () => {
    mockFs.readFileSync.mockReturnValue('| G-001 | P0 | done | 30m | Only |\n');
    expect(sup.recentDoneGoals(5)).toHaveLength(1);
  });

  it('returns [] on read failure', () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(sup.recentDoneGoals(3)).toEqual([]);
  });

  it('ignores non-done rows', () => {
    mockFs.readFileSync.mockReturnValue(
      '| G-001 | P0 | open | 30m | Not done |\n| G-002 | P1 | in_progress | 30m | Also not done |\n',
    );
    expect(sup.recentDoneGoals(5)).toEqual([]);
  });
});

describe('currentOpenGoal', () => {
  it('picks top open P0 via pickNext', () => {
    const md = [
      '## Active',
      '| G-010 | P2 | open | 30m | Polish later |',
      '| G-011 | P0 | open | 30m | Ship now |',
      '',
    ].join('\n');
    mockFs.readFileSync.mockReturnValue(md);
    expect(sup.currentOpenGoal()).toEqual({ id: 'G-011', title: 'Ship now' });
  });

  it('returns null when no open goals exist', () => {
    mockFs.readFileSync.mockReturnValue('## Active\n| G-100 | P0 | done | 30m | Completed |\n');
    expect(sup.currentOpenGoal()).toBeNull();
  });

  it('returns null when GOALS.md cannot be read', () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(sup.currentOpenGoal()).toBeNull();
  });
});

describe('ensureNorthStar', () => {
  it('writes default NORTH_STAR.json when missing', () => {
    mockFs.existsSync.mockReturnValue(false);
    const ns = sup.ensureNorthStar();
    expect(mockFs.writeFileSync).toHaveBeenCalled();
    const [writePath, body] = mockFs.writeFileSync.mock.calls[0];
    expect(writePath).toMatch(/NORTH_STAR\.json$/);
    expect(JSON.parse(body)).toMatchObject({
      schemaVersion: 1,
      deployed_staging: false,
      blockers: [],
    });
    expect(ns.deployed_staging).toBe(false);
  });

  it('reads existing file when present', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ deployed_staging: true, real_402_issued_count: 5 }),
    );
    const ns = sup.ensureNorthStar();
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    expect(ns).toMatchObject({ deployed_staging: true, real_402_issued_count: 5 });
  });

  it('returns default when existing file is malformed', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('not-json');
    const ns = sup.ensureNorthStar();
    expect(ns).toMatchObject({ schemaVersion: 1, deployed_staging: false });
  });
});

describe('writeStuckReport', () => {
  const baseArgs = {
    reasons: ['All goals are polish', 'Coverage plateau'],
    recentGoals: [
      { id: 'G-100', title: 'Add tests' },
      { id: 'G-101', title: 'Fix lint' },
    ],
    northStar: {
      deployed_staging: false,
      real_402_issued_count: 0,
      blockers: ['G-156'],
    },
    state: {
      coveragePct: 97.5,
      testCount: 3000,
      testFileCount: 130,
      doneGoals: 200,
      openGoals: 3,
      bundleSizeKb: 240,
    },
    currentGoal: { id: 'G-172', title: 'Add tests for supervisor' },
    tick: 42,
  };

  it('writes markdown with all sections', () => {
    const body = sup.writeStuckReport(baseArgs);
    expect(mockFs.writeFileSync).toHaveBeenCalled();
    const [writePath, content] = mockFs.writeFileSync.mock.calls[0];
    expect(writePath).toMatch(/STUCK\.md$/);
    expect(content).toContain('Autopilot Stuck — tick #42');
    expect(content).toContain('All goals are polish');
    expect(content).toContain('Coverage plateau');
    expect(content).toContain('G-100');
    expect(content).toContain('G-172');
    expect(content).toContain('Add tests for supervisor');
    expect(content).toContain('97.5%');
    expect(content).toContain('3000');
    expect(content).toContain('"deployed_staging": false');
    expect(body).toBe(content);
  });

  it('handles null currentGoal gracefully', () => {
    const body = sup.writeStuckReport({ ...baseArgs, currentGoal: null });
    expect(body).toContain('(no open goal picked)');
  });

  it('handles empty recentGoals list', () => {
    const body = sup.writeStuckReport({ ...baseArgs, recentGoals: [] });
    expect(body).toContain('(none)');
  });

  it('classifies recent goals inline', () => {
    const body = sup.writeStuckReport(baseArgs);
    expect(body).toContain('`polish`');
  });

  it('renders missing state fields as "?"', () => {
    const body = sup.writeStuckReport({ ...baseArgs, state: {} });
    expect(body).toContain('Coverage: ?%');
    expect(body).toContain('Tests: ?');
  });
});

describe('openGitHubIssue', () => {
  it('skips creation when GH_AUTOPILOT_ISSUES is not "true"', () => {
    delete process.env.GH_AUTOPILOT_ISSUES;
    const result = sup.openGitHubIssue('title', 'body');
    expect(result).toBeNull();
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('skips creation when a stuck issue already exists', () => {
    process.env.GH_AUTOPILOT_ISSUES = 'true';
    mockExecSync.mockReturnValueOnce('[{"number":5}]');
    const result = sup.openGitHubIssue('title', 'body');
    expect(result).toBeNull();
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('creates an issue when none exists', () => {
    process.env.GH_AUTOPILOT_ISSUES = 'true';
    mockExecSync
      .mockReturnValueOnce('[]')
      .mockReturnValueOnce('https://github.com/x/y/issues/42\n');
    const result = sup.openGitHubIssue('title', 'body');
    expect(result).toBe('https://github.com/x/y/issues/42');
    expect(mockFs.writeFileSync).toHaveBeenCalled();
    const createCall = mockExecSync.mock.calls[1][0];
    expect(createCall).toContain('gh issue create');
    expect(createCall).toContain('autopilot-stuck');
  });

  it('tolerates unlink error after issue creation', () => {
    process.env.GH_AUTOPILOT_ISSUES = 'true';
    mockExecSync.mockReturnValueOnce('[]').mockReturnValueOnce('issue-url\n');
    mockFs.unlinkSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(() => sup.openGitHubIssue('title', 'body')).not.toThrow();
  });

  it('returns null when gh CLI fails', () => {
    process.env.GH_AUTOPILOT_ISSUES = 'true';
    mockExecSync.mockImplementation(() => {
      throw new Error('gh not installed');
    });
    expect(sup.openGitHubIssue('title', 'body')).toBeNull();
  });
});

describe('main', () => {
  let exitCalls;
  let origExit;
  let origArgv;

  beforeEach(() => {
    exitCalls = [];
    origExit = process.exit;
    origArgv = process.argv;
    process.exit = vi.fn((code) => {
      exitCalls.push(code);
      throw new Error(`exit(${code})`);
    });
  });

  afterEach(() => {
    process.exit = origExit;
    process.argv = origArgv;
  });

  it('exits 1 when STUCK.md already exists', () => {
    process.argv = ['node', 'supervisor.js', '--tick=7'];
    mockFs.existsSync.mockReturnValue(true);
    expect(() => sup.main()).toThrow('exit(1)');
    expect(exitCalls).toEqual([1]);
    expect(mockFs.appendFileSync).toHaveBeenCalled();
  });

  it('exits 0 healthy when no reasons and --dry-run', () => {
    process.argv = ['node', 'supervisor.js', '--tick=1', '--dry-run'];
    mockFs.existsSync.mockImplementation((p) => p.endsWith('NORTH_STAR.json'));
    mockFs.readFileSync.mockImplementation((p) => {
      if (p.endsWith('NORTH_STAR.json')) {
        return JSON.stringify({
          deployed_staging: true,
          real_402_issued_count: 2,
          blockers: [],
        });
      }
      if (p.endsWith('state.json')) {
        return JSON.stringify({ coveragePct: 50, doneGoals: 10 });
      }
      if (p.endsWith('GOALS.md')) {
        return '## Active\n| G-200 | P0 | open | 30m | Deploy to prod |\n';
      }
      if (p.endsWith('NORTH_STAR_HISTORY.jsonl')) {
        return '';
      }
      return '';
    });
    expect(() => sup.main()).toThrow('exit(0)');
    expect(exitCalls).toEqual([0]);
    expect(mockFs.writeFileSync).not.toHaveBeenCalledWith(
      expect.stringMatching(/STUCK\.md$/),
      expect.anything(),
    );
  });

  it('writes STUCK.md when hard violation detected', () => {
    process.argv = ['node', 'supervisor.js', '--tick=9'];
    process.env.GH_AUTOPILOT_ISSUES = 'false';
    mockFs.existsSync.mockImplementation((p) => p.endsWith('NORTH_STAR.json'));
    mockFs.readFileSync.mockImplementation((p) => {
      if (p.endsWith('NORTH_STAR.json')) {
        return JSON.stringify({
          deployed_staging: false,
          real_402_issued_count: 0,
          blockers: [],
        });
      }
      if (p.endsWith('state.json')) {
        return JSON.stringify({ coveragePct: 80, doneGoals: 10 });
      }
      if (p.endsWith('GOALS.md')) {
        return '## Active\n| G-300 | P2 | open | 30m | Add unit tests for thing |\n';
      }
      return '';
    });
    expect(() => sup.main()).toThrow('exit(1)');
    expect(exitCalls).toEqual([1]);
    const stuckWrites = mockFs.writeFileSync.mock.calls.filter((c) => c[0].endsWith('STUCK.md'));
    expect(stuckWrites.length).toBe(1);
    expect(stuckWrites[0][1]).toContain('HARD VIOLATION');
  });

  it('honors --force-healthy flag', () => {
    process.argv = ['node', 'supervisor.js', '--tick=1', '--force-healthy', '--dry-run'];
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('');
    expect(() => sup.main()).toThrow('exit(0)');
    expect(exitCalls).toEqual([0]);
  });

  it('honors --force-stuck flag', () => {
    process.argv = ['node', 'supervisor.js', '--tick=1', '--force-stuck', '--dry-run'];
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('');
    expect(() => sup.main()).toThrow('exit(1)');
    expect(exitCalls).toEqual([1]);
  });
});
