import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

let script;

beforeAll(() => {
  script = readFileSync('docker/autopilot-entrypoint.sh', 'utf8');
});

describe('autopilot-entrypoint.sh — defaults', () => {
  it('defaults MAX_MINUTES to 60', () => {
    const match = script.match(/MAX_MINUTES="\$\{AUTOPILOT_MAX_MINUTES:-(\d+)\}"/);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBe(60);
  });

  it('MAX_MINUTES is overridable via AUTOPILOT_MAX_MINUTES', () => {
    expect(script).toContain('AUTOPILOT_MAX_MINUTES');
  });

  it('defaults INTERVAL_MINUTES to 60', () => {
    const match = script.match(/INTERVAL_MINUTES="\$\{AUTOPILOT_INTERVAL_MINUTES:-(\d+)\}"/);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBe(60);
  });

  it('defaults REPLENISH_THRESHOLD to 1', () => {
    const match = script.match(/REPLENISH_THRESHOLD="\$\{AUTOPILOT_REPLENISH_THRESHOLD:-(\d+)\}"/);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBe(1);
  });

  it('uses timeout with MAX_MINUTES for claude invocation', () => {
    expect(script).toMatch(/timeout "\$\{MAX_MINUTES\}m" claude/);
  });

  it('uses timeout with MAX_MINUTES for replenish invocation', () => {
    const replenishTimeout = script.match(/timeout "\$\{MAX_MINUTES\}m" claude/g);
    expect(replenishTimeout.length).toBeGreaterThanOrEqual(2);
  });
});

describe('autopilot-entrypoint.sh — safety', () => {
  it('does not set -e (one bad tick must not kill the loop)', () => {
    expect(script).toContain('set -u');
    expect(script).not.toMatch(/^set -e$/m);
    expect(script).not.toMatch(/set -eu/);
  });

  it('defaults AUTO_PUSH to false', () => {
    expect(script).toContain('AUTO_PUSH="${AGENT_AUTO_PUSH:-false}"');
  });

  it('defaults model to claude-opus-4-6', () => {
    expect(script).toContain('MODEL="${AUTOPILOT_MODEL:-claude-opus-4-6}"');
  });

  it('uses --dangerously-skip-permissions for headless mode', () => {
    const matches = script.match(/--dangerously-skip-permissions/g);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('does not hardcode 15-minute budget in comments', () => {
    expect(script).not.toContain('15-minute tick budget');
  });
});

describe('autopilot-entrypoint.sh — goal picker', () => {
  it('sorts goal lines by priority before head -1', () => {
    expect(script).toContain("sort -t'|' -k3,3 | head -1");
  });

  it('greps for open and in_progress goals', () => {
    expect(script).toMatch(/grep.*open\|in_progress/);
  });
});

describe('autopilot-entrypoint.sh — structure', () => {
  it('defines a log function', () => {
    expect(script).toMatch(/^log\(\)/m);
  });

  it('defines a check_api_headroom function', () => {
    expect(script).toContain('check_api_headroom()');
  });

  it('defines a canary_check function', () => {
    expect(script).toContain('canary_check()');
  });

  it('defines a pause_on_exhaustion function', () => {
    expect(script).toContain('pause_on_exhaustion()');
  });

  it('runs agent:start before claude invocation', () => {
    const startIdx = script.indexOf('agent:start');
    const claudeIdx = script.indexOf('timeout "${MAX_MINUTES}m" claude');
    expect(startIdx).toBeLessThan(claudeIdx);
  });

  it('runs post-tick lint gate after claude finishes', () => {
    const claudeIdx = script.indexOf('CLAUDE_EXIT=$?');
    const postLintIdx = script.indexOf('post-tick gate: lint');
    expect(claudeIdx).toBeLessThan(postLintIdx);
  });
});
