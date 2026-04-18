import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

let wf;
let raw;

beforeAll(() => {
  raw = readFileSync('.github/workflows/autopilot.yml', 'utf8');
  wf = parse(raw);
});

describe('autopilot workflow — triggers', () => {
  it('is named autopilot', () => {
    expect(wf.name).toBe('autopilot');
  });

  it('triggers on workflow_dispatch only (schedule disabled — local Docker autopilot)', () => {
    expect(Object.keys(wf.on)).toEqual(['workflow_dispatch']);
  });

  it('workflow_dispatch exposes an optional goalId input', () => {
    const input = wf.on.workflow_dispatch.inputs.goalId;
    expect(input).toBeDefined();
    expect(input.required).toBe(false);
    expect(input.description).toMatch(/goal/i);
  });
});

describe('autopilot workflow — permissions', () => {
  it('requests contents write (for commits + push)', () => {
    expect(wf.permissions.contents).toBe('write');
  });

  it('requests pull-requests write (for optional PR creation)', () => {
    expect(wf.permissions['pull-requests']).toBe('write');
  });

  it('requests exactly 2 permission scopes (least-privilege)', () => {
    expect(Object.keys(wf.permissions)).toHaveLength(2);
  });
});

describe('autopilot workflow — concurrency', () => {
  it('serializes runs under a single concurrency group', () => {
    expect(wf.concurrency.group).toBe('autopilot');
  });

  it('never cancels an in-flight tick (ticks are atomic)', () => {
    expect(wf.concurrency['cancel-in-progress']).toBe(false);
  });
});

describe('autopilot workflow — tick job', () => {
  it('defines a single tick job', () => {
    expect(Object.keys(wf.jobs)).toEqual(['tick']);
  });

  it('runs on ubuntu-latest', () => {
    expect(wf.jobs.tick['runs-on']).toBe('ubuntu-latest');
  });

  it('caps wall time at 20 minutes', () => {
    expect(wf.jobs.tick['timeout-minutes']).toBe(20);
  });

  it('checks out the autopilot branch with full history', () => {
    const checkout = wf.jobs.tick.steps.find((s) => s.uses?.startsWith('actions/checkout'));
    expect(checkout).toBeDefined();
    expect(checkout.with.ref).toBe('autopilot');
    expect(checkout.with['fetch-depth']).toBe(0);
  });

  it('sets up node 20 with npm cache', () => {
    const setup = wf.jobs.tick.steps.find((s) => s.uses?.startsWith('actions/setup-node'));
    expect(setup.with['node-version']).toBe('20');
    expect(setup.with.cache).toBe('npm');
  });
});

describe('autopilot workflow — green-bar gating', () => {
  const namedStep = (name) => wf.jobs.tick.steps.find((s) => s.name === name);

  it('verifies repo is green BEFORE invoking Claude', () => {
    const pre = namedStep('Verify repo is green before tick');
    expect(pre).toBeDefined();
    expect(pre.run).toContain('npm run lint');
    expect(pre.run).toContain('npm test');
  });

  it('verifies repo is green AFTER invoking Claude', () => {
    const post = namedStep('Verify repo is green after tick');
    expect(post).toBeDefined();
    expect(post.run).toContain('npm run lint');
    expect(post.run).toContain('npm test');
  });

  it('runs the pre-verify step before the Claude tick step', () => {
    const stepNames = wf.jobs.tick.steps.map((s) => s.name);
    expect(stepNames.indexOf('Verify repo is green before tick')).toBeLessThan(
      stepNames.indexOf('Run Claude tick'),
    );
  });

  it('runs the post-verify step after the Claude tick step', () => {
    const stepNames = wf.jobs.tick.steps.map((s) => s.name);
    expect(stepNames.indexOf('Verify repo is green after tick')).toBeGreaterThan(
      stepNames.indexOf('Run Claude tick'),
    );
  });
});

describe('autopilot workflow — Claude tick invocation', () => {
  let claudeStep;

  beforeAll(() => {
    claudeStep = wf.jobs.tick.steps.find((s) => s.name === 'Run Claude tick');
  });

  it('is a named step in the tick job', () => {
    expect(claudeStep).toBeDefined();
  });

  it('passes ANTHROPIC_API_KEY from secrets (never hardcoded)', () => {
    expect(claudeStep.env.ANTHROPIC_API_KEY).toBe('${{ secrets.ANTHROPIC_API_KEY }}');
  });

  it('forwards the optional goalId workflow_dispatch input', () => {
    expect(claudeStep.env.GOAL_ID).toBe('${{ inputs.goalId }}');
  });

  it('invokes the Claude Agent SDK with the pinned model', () => {
    expect(claudeStep.run).toContain('@anthropic-ai/claude-agent-sdk');
    expect(claudeStep.run).toContain('--model claude-opus-4-6');
  });

  it('reads the tick loop prompt from .agent/CLAUDE_LOOP.md', () => {
    expect(claudeStep.run).toContain('--prompt-file .agent/CLAUDE_LOOP.md');
  });
});

describe('autopilot workflow — state + commit', () => {
  const namedStep = (name) => wf.jobs.tick.steps.find((s) => s.name === name);

  it('runs agent:start before the Claude tick', () => {
    const start = namedStep('Print current state');
    expect(start).toBeDefined();
    expect(start.run).toBe('npm run agent:start');
    const idx = (n) => wf.jobs.tick.steps.findIndex((s) => s.name === n);
    expect(idx('Print current state')).toBeLessThan(idx('Run Claude tick'));
  });

  it('runs agent:end with --tag=autopilot after the Claude tick', () => {
    const endStep = namedStep('Update state snapshot');
    expect(endStep).toBeDefined();
    expect(endStep.run).toBe('npm run agent:end -- --tag=autopilot');
  });

  it('commits the tick and pushes to the autopilot branch', () => {
    const commit = namedStep('Commit tick');
    expect(commit).toBeDefined();
    expect(commit.run).toContain('git commit');
    expect(commit.run).toContain('git push origin autopilot');
  });

  it('no-ops gracefully when the tick produced no diff', () => {
    const commit = namedStep('Commit tick');
    expect(commit.run).toContain('git diff --cached --quiet');
  });

  it('configures a bot git identity (not a real author)', () => {
    const commit = namedStep('Commit tick');
    expect(commit.run).toContain('x402-autopilot');
    expect(commit.run).toContain('autopilot@x402.local');
  });
});

describe('autopilot workflow — security', () => {
  it('never contains hardcoded secrets or 12-digit account IDs', () => {
    expect(raw).not.toMatch(/AKIA[A-Z0-9]{16}/);
    expect(raw).not.toMatch(/\b\d{12}\b/);
  });

  it('pins all actions/* steps to a major version', () => {
    const officialSteps = wf.jobs.tick.steps.filter((s) => s.uses?.startsWith('actions/'));
    expect(officialSteps.length).toBeGreaterThan(0);
    for (const step of officialSteps) {
      expect(step.uses).not.toMatch(/@(main|master|latest)$/);
      expect(step.uses).toMatch(/@v\d+/);
    }
  });
});
