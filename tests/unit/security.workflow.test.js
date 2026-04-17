import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

let wf;
let raw;

beforeAll(() => {
  raw = readFileSync('.github/workflows/security.yml', 'utf8');
  wf = parse(raw);
});

describe('security workflow — triggers', () => {
  it('is named security', () => {
    expect(wf.name).toBe('security');
  });

  it('triggers on pull_request and weekly schedule', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['pull_request', 'schedule']);
  });

  it('pull_request trigger has no branch restriction (runs on every PR)', () => {
    expect(wf.on.pull_request).toBeNull();
  });

  it('schedule runs weekly on Monday at 06:00 UTC', () => {
    expect(wf.on.schedule).toHaveLength(1);
    expect(wf.on.schedule[0].cron).toBe('0 6 * * 1');
  });
});

describe('security workflow — scan job', () => {
  it('defines a single scan job', () => {
    expect(Object.keys(wf.jobs)).toEqual(['scan']);
  });

  it('runs on ubuntu-latest', () => {
    expect(wf.jobs.scan['runs-on']).toBe('ubuntu-latest');
  });

  it('step 1 checks out the repo', () => {
    expect(wf.jobs.scan.steps[0].uses).toBe('actions/checkout@v4');
  });

  it('step 2 sets up node 20 with npm cache', () => {
    const setup = wf.jobs.scan.steps[1];
    expect(setup.uses).toBe('actions/setup-node@v4');
    expect(setup.with['node-version']).toBe('20');
    expect(setup.with.cache).toBe('npm');
  });

  it('installs deps with npm ci before running scans', () => {
    const stepIndex = (cmd) => wf.jobs.scan.steps.findIndex((s) => s.run === cmd);
    const ciIdx = stepIndex('npm ci');
    expect(ciIdx).toBeGreaterThan(-1);
    const auditStep = wf.jobs.scan.steps.find((s) => s.name === 'Dependency audit (high+)');
    expect(auditStep).toBeDefined();
    const auditIdx = wf.jobs.scan.steps.indexOf(auditStep);
    expect(auditIdx).toBeGreaterThan(ciIdx);
  });
});

describe('security workflow — dependency audit', () => {
  let audit;

  beforeAll(() => {
    audit = wf.jobs.scan.steps.find((s) => s.name === 'Dependency audit (high+)');
  });

  it('is a named step in the scan job', () => {
    expect(audit).toBeDefined();
  });

  it('runs npm audit at high severity threshold', () => {
    expect(audit.run).toBe('npm audit --audit-level=high');
  });
});

describe('security workflow — secret scan', () => {
  let secretScan;

  beforeAll(() => {
    secretScan = wf.jobs.scan.steps.find((s) => s.name === 'Secret scan');
  });

  it('is a named step in the scan job', () => {
    expect(secretScan).toBeDefined();
  });

  it('uses trufflehog for verified secret detection', () => {
    expect(secretScan.uses).toMatch(/^trufflesecurity\/trufflehog/);
  });

  it('scans the repository root', () => {
    expect(secretScan.with.path).toBe('./');
  });

  it('reports only verified secrets (no false-positive noise)', () => {
    expect(secretScan.with.extra_args).toBe('--only-verified');
  });
});

describe('security workflow — security', () => {
  it('never contains hardcoded secrets or 12-digit account IDs', () => {
    expect(raw).not.toMatch(/AKIA[A-Z0-9]{16}/);
    expect(raw).not.toMatch(/\b\d{12}\b/);
  });

  it('pins all official actions/* steps to a major version', () => {
    const officialSteps = wf.jobs.scan.steps.filter((s) => s.uses?.startsWith('actions/'));
    expect(officialSteps.length).toBeGreaterThan(0);
    for (const step of officialSteps) {
      expect(step.uses).not.toMatch(/@(main|master|latest)$/);
      expect(step.uses).toMatch(/@v\d+/);
    }
  });
});
