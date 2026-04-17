import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

let wf;
let raw;

beforeAll(() => {
  raw = readFileSync('.github/workflows/ci.yml', 'utf8');
  wf = parse(raw);
});

describe('ci workflow — triggers', () => {
  it('is named ci', () => {
    expect(wf.name).toBe('ci');
  });

  it('triggers on push to main and on pull_request', () => {
    expect(Object.keys(wf.on)).toEqual(['push', 'pull_request']);
  });

  it('push trigger targets main branch only', () => {
    expect(wf.on.push.branches).toEqual(['main']);
  });

  it('pull_request trigger has no branch restriction (runs on every PR)', () => {
    expect(wf.on.pull_request).toBeNull();
  });
});

describe('ci workflow — verify job', () => {
  it('defines a single verify job', () => {
    expect(Object.keys(wf.jobs)).toEqual(['verify']);
  });

  it('runs on ubuntu-latest', () => {
    expect(wf.jobs.verify['runs-on']).toBe('ubuntu-latest');
  });

  it('checks out the repo as the first step', () => {
    expect(wf.jobs.verify.steps[0].uses).toBe('actions/checkout@v4');
  });

  it('sets up node 20 with npm cache', () => {
    const setup = wf.jobs.verify.steps.find((s) => s.uses?.startsWith('actions/setup-node'));
    expect(setup).toBeDefined();
    expect(setup.with['node-version']).toBe('20');
    expect(setup.with.cache).toBe('npm');
  });

  it('runs npm ci before any other npm script', () => {
    const stepIndex = (cmd) => wf.jobs.verify.steps.findIndex((s) => s.run === cmd);
    const ciIdx = stepIndex('npm ci');
    expect(ciIdx).toBeGreaterThan(-1);
    expect(stepIndex('npm run lint')).toBeGreaterThan(ciIdx);
    expect(stepIndex('npm test')).toBeGreaterThan(ciIdx);
  });
});

describe('ci workflow — required quality gates', () => {
  const findRunStep = (cmd) => wf.jobs.verify.steps.find((s) => s.run === cmd);
  const findNamedStep = (name) => wf.jobs.verify.steps.find((s) => s.name === name);

  it('runs the TypeScript file guard', () => {
    const step = findNamedStep('Guard against TypeScript files');
    expect(step).toBeDefined();
    expect(step.run).toBe('npm run guard:ts');
  });

  it('runs prettier format check', () => {
    expect(findRunStep('npm run format:check')).toBeDefined();
  });

  it('runs eslint', () => {
    expect(findRunStep('npm run lint')).toBeDefined();
  });

  it('validates OpenAPI spec', () => {
    expect(findRunStep('npm run validate:openapi')).toBeDefined();
  });

  it('runs the test suite', () => {
    expect(findRunStep('npm test')).toBeDefined();
  });

  it('runs npm audit (high severity)', () => {
    expect(findRunStep('npm run audit')).toBeDefined();
  });

  it('runs the build', () => {
    expect(findRunStep('npm run build')).toBeDefined();
  });

  it('synthesizes CDK with STAGE=dev', () => {
    const step = findRunStep('npm run cdk:synth');
    expect(step).toBeDefined();
    expect(step.env.STAGE).toBe('dev');
  });

  it('validates the smoke-test script syntax', () => {
    const step = findNamedStep('Validate smoke-test script syntax');
    expect(step).toBeDefined();
    expect(step.run).toBe('node --check scripts/smoke-test.js');
  });
});

describe('ci workflow — coverage artifact', () => {
  let upload;

  beforeAll(() => {
    upload = wf.jobs.verify.steps.find((s) => s.uses?.startsWith('actions/upload-artifact'));
  });

  it('uploads the coverage report', () => {
    expect(upload).toBeDefined();
    expect(upload.with.name).toBe('coverage-report');
    expect(upload.with.path).toBe('coverage/');
  });

  it('uploads coverage even when prior steps fail', () => {
    expect(upload.if).toBe('always()');
  });

  it('retains coverage for 14 days', () => {
    expect(upload.with['retention-days']).toBe(14);
  });
});

describe('ci workflow — security', () => {
  it('never contains hardcoded secrets or 12-digit account IDs', () => {
    expect(raw).not.toMatch(/AKIA[A-Z0-9]{16}/);
    expect(raw).not.toMatch(/\b\d{12}\b/);
  });

  it('uses only pinned major-version actions (no @main, no @latest)', () => {
    const usesSteps = wf.jobs.verify.steps.filter((s) => s.uses);
    for (const step of usesSteps) {
      expect(step.uses).not.toMatch(/@(main|master|latest)$/);
      expect(step.uses).toMatch(/@v\d+/);
    }
  });
});
