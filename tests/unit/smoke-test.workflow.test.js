import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

let wf;
let raw;

beforeAll(() => {
  raw = readFileSync('.github/workflows/smoke-test.yml', 'utf8');
  wf = parse(raw);
});

describe('smoke-test workflow — triggers', () => {
  it('is named smoke-test', () => {
    expect(wf.name).toBe('smoke-test');
  });

  it('is callable as a reusable workflow (workflow_call)', () => {
    expect(wf.on.workflow_call).toBeDefined();
  });

  it('is also runnable manually (workflow_dispatch)', () => {
    expect(wf.on.workflow_dispatch).toBeDefined();
  });

  it('exposes only workflow_call and workflow_dispatch triggers', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['workflow_call', 'workflow_dispatch']);
  });
});

describe('smoke-test workflow — workflow_call inputs', () => {
  let inputs;

  beforeAll(() => {
    inputs = wf.on.workflow_call.inputs;
  });

  it('requires a base_url string', () => {
    expect(inputs.base_url.required).toBe(true);
    expect(inputs.base_url.type).toBe('string');
  });

  it('accepts an optional strict boolean defaulting to true', () => {
    expect(inputs.strict.required).toBe(false);
    expect(inputs.strict.type).toBe('boolean');
    expect(inputs.strict.default).toBe(true);
  });
});

describe('smoke-test workflow — workflow_dispatch inputs', () => {
  let inputs;

  beforeAll(() => {
    inputs = wf.on.workflow_dispatch.inputs;
  });

  it('requires a base_url string', () => {
    expect(inputs.base_url.required).toBe(true);
    expect(inputs.base_url.type).toBe('string');
  });

  it('accepts an optional strict boolean defaulting to true', () => {
    expect(inputs.strict.required).toBe(false);
    expect(inputs.strict.type).toBe('boolean');
    expect(inputs.strict.default).toBe(true);
  });

  it('mirrors the same input shape as workflow_call', () => {
    const callKeys = Object.keys(wf.on.workflow_call.inputs).sort();
    const dispatchKeys = Object.keys(inputs).sort();
    expect(dispatchKeys).toEqual(callKeys);
  });
});

describe('smoke-test workflow — smoke job', () => {
  it('defines a single smoke job', () => {
    expect(Object.keys(wf.jobs)).toEqual(['smoke']);
  });

  it('runs on ubuntu-latest', () => {
    expect(wf.jobs.smoke['runs-on']).toBe('ubuntu-latest');
  });

  it('caps execution at 5 minutes', () => {
    expect(wf.jobs.smoke['timeout-minutes']).toBe(5);
  });

  it('checks out the repo as the first step', () => {
    expect(wf.jobs.smoke.steps[0].uses).toBe('actions/checkout@v4');
  });

  it('sets up node 20', () => {
    const setup = wf.jobs.smoke.steps.find((s) => s.uses?.startsWith('actions/setup-node'));
    expect(setup).toBeDefined();
    expect(setup.with['node-version']).toBe('20');
  });
});

describe('smoke-test workflow — run step', () => {
  let run;

  beforeAll(() => {
    run = wf.jobs.smoke.steps.find((s) => s.name === 'Run smoke tests');
  });

  it('exists and runs scripts/smoke-test.js', () => {
    expect(run).toBeDefined();
    expect(run.run).toContain('node scripts/smoke-test.js');
  });

  it('conditionally appends --strict based on the strict input', () => {
    expect(run.run).toContain("inputs.strict && '--strict' || ''");
  });

  it('passes the base_url through SMOKE_BASE_URL env var', () => {
    expect(run.env.SMOKE_BASE_URL).toContain('inputs.base_url');
  });
});

describe('smoke-test workflow — security', () => {
  it('never contains hardcoded secrets or 12-digit account IDs', () => {
    expect(raw).not.toMatch(/AKIA[A-Z0-9]{16}/);
    expect(raw).not.toMatch(/\b\d{12}\b/);
  });

  it('uses only pinned major-version actions (no @main, no @latest)', () => {
    const usesSteps = wf.jobs.smoke.steps.filter((s) => s.uses);
    for (const step of usesSteps) {
      expect(step.uses).not.toMatch(/@(main|master|latest)$/);
      expect(step.uses).toMatch(/@v\d+/);
    }
  });

  it('does not request elevated workflow permissions', () => {
    expect(wf.permissions).toBeUndefined();
  });
});
