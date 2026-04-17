import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

let wf;
let raw;

beforeAll(() => {
  raw = readFileSync('.github/workflows/codeql.yml', 'utf8');
  wf = parse(raw);
});

describe('codeql workflow — triggers', () => {
  it('is named codeql', () => {
    expect(wf.name).toBe('codeql');
  });

  it('triggers on pull_request, push to main, and weekly schedule', () => {
    const triggers = Object.keys(wf.on);
    expect(triggers).toContain('pull_request');
    expect(triggers).toContain('push');
    expect(triggers).toContain('schedule');
  });

  it('push trigger targets main branch only', () => {
    expect(wf.on.push.branches).toEqual(['main']);
  });

  it('schedule runs weekly on Monday at 04:00 UTC', () => {
    expect(wf.on.schedule).toHaveLength(1);
    expect(wf.on.schedule[0].cron).toBe('0 4 * * 1');
  });
});

describe('codeql workflow — permissions', () => {
  it('requests security-events write permission', () => {
    expect(wf.permissions['security-events']).toBe('write');
  });

  it('requests contents read permission', () => {
    expect(wf.permissions.contents).toBe('read');
  });

  it('has exactly 2 permission scopes (least-privilege)', () => {
    expect(Object.keys(wf.permissions)).toHaveLength(2);
  });
});

describe('codeql workflow — analyze job', () => {
  it('defines a single analyze job', () => {
    expect(Object.keys(wf.jobs)).toEqual(['analyze']);
  });

  it('runs on ubuntu-latest', () => {
    expect(wf.jobs.analyze['runs-on']).toBe('ubuntu-latest');
  });

  it('has 4 steps: checkout, init, autobuild, analyze', () => {
    expect(wf.jobs.analyze.steps).toHaveLength(4);
  });

  it('step 1 checks out the repo', () => {
    expect(wf.jobs.analyze.steps[0].uses).toBe('actions/checkout@v4');
  });

  it('step 2 initializes CodeQL with javascript-typescript', () => {
    const init = wf.jobs.analyze.steps[1];
    expect(init.uses).toBe('github/codeql-action/init@v3');
    expect(init.with.languages).toBe('javascript-typescript');
  });

  it('step 2 uses security-extended query suite', () => {
    const init = wf.jobs.analyze.steps[1];
    expect(init.with.queries).toBe('security-extended');
  });

  it('step 3 runs autobuild', () => {
    expect(wf.jobs.analyze.steps[2].uses).toBe('github/codeql-action/autobuild@v3');
  });

  it('step 4 performs analysis with category', () => {
    const analyze = wf.jobs.analyze.steps[3];
    expect(analyze.uses).toBe('github/codeql-action/analyze@v3');
    expect(analyze.with.category).toBe('/language:javascript-typescript');
  });
});

describe('codeql workflow — security', () => {
  it('never contains hardcoded secrets or account IDs', () => {
    expect(raw).not.toMatch(/AKIA[A-Z0-9]{16}/);
    expect(raw).not.toMatch(/\d{12}/);
  });

  it('uses only official github/codeql-action actions', () => {
    const actionSteps = wf.jobs.analyze.steps.filter(
      (s) => s.uses && s.uses !== 'actions/checkout@v4',
    );
    for (const step of actionSteps) {
      expect(step.uses).toMatch(/^github\/codeql-action\//);
    }
  });

  it('all codeql actions pin to v3', () => {
    const codeqlSteps = wf.jobs.analyze.steps.filter((s) =>
      s.uses?.startsWith('github/codeql-action/'),
    );
    expect(codeqlSteps).toHaveLength(3);
    for (const step of codeqlSteps) {
      expect(step.uses).toMatch(/@v3$/);
    }
  });
});
