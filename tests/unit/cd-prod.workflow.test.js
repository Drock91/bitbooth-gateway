import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

let wf;

beforeAll(() => {
  const raw = readFileSync('.github/workflows/cd-prod.yml', 'utf8');
  wf = parse(raw);
});

describe('cd-prod workflow — structure', () => {
  it('is named cd-prod', () => {
    expect(wf.name).toBe('cd-prod');
  });

  it('triggers only on workflow_dispatch', () => {
    expect(Object.keys(wf.on)).toEqual(['workflow_dispatch']);
  });

  it('requires ref input', () => {
    const ref = wf.on.workflow_dispatch.inputs.ref;
    expect(ref.required).toBe(true);
    expect(ref.type).toBe('string');
  });

  it('has optional skip_diff input', () => {
    const skip = wf.on.workflow_dispatch.inputs.skip_diff;
    expect(skip.required).toBe(false);
    expect(skip.type).toBe('boolean');
    expect(skip.default).toBe(false);
  });

  it('requests OIDC id-token write permission', () => {
    expect(wf.permissions['id-token']).toBe('write');
    expect(wf.permissions.contents).toBe('read');
  });
});

describe('cd-prod workflow — jobs', () => {
  it('defines 4 jobs in order: diff, approve, deploy, smoke', () => {
    expect(Object.keys(wf.jobs)).toEqual(['diff', 'approve', 'deploy', 'smoke']);
  });

  it('diff job skips when skip_diff is true', () => {
    expect(wf.jobs.diff.if).toContain('!inputs.skip_diff');
  });

  it('diff job uses production-diff environment', () => {
    expect(wf.jobs.diff.environment).toBe('production-diff');
  });

  it('diff job sets STAGE=prod', () => {
    const cdkDiffStep = wf.jobs.diff.steps.find((s) => s.name === 'CDK diff (prod)');
    expect(cdkDiffStep).toBeDefined();
    expect(cdkDiffStep.env.STAGE).toBe('prod');
  });

  it('approve job needs diff and handles skipped diff', () => {
    expect(wf.jobs.approve.needs).toBe('diff');
    expect(wf.jobs.approve.if).toContain("needs.diff.result == 'success'");
    expect(wf.jobs.approve.if).toContain("needs.diff.result == 'skipped'");
  });

  it('approve job uses production environment (manual gate)', () => {
    expect(wf.jobs.approve.environment).toBe('production');
  });

  it('deploy job needs approve', () => {
    expect(wf.jobs.deploy.needs).toBe('approve');
  });

  it('deploy job has concurrency group cd-prod', () => {
    expect(wf.jobs.deploy.concurrency.group).toBe('cd-prod');
    expect(wf.jobs.deploy.concurrency['cancel-in-progress']).toBe(false);
  });

  it('deploy job runs cdk:deploy:prod with STAGE=prod', () => {
    const deployStep = wf.jobs.deploy.steps.find((s) => s.name === 'CDK deploy prod');
    expect(deployStep).toBeDefined();
    expect(deployStep.env.STAGE).toBe('prod');
    expect(deployStep.run).toContain('cdk:deploy:prod');
  });

  it('deploy job checks out the specified ref', () => {
    const checkout = wf.jobs.deploy.steps.find((s) => s.uses?.startsWith('actions/checkout'));
    expect(checkout.with.ref).toContain('inputs.ref');
  });

  it('smoke job needs deploy', () => {
    expect(wf.jobs.smoke.needs).toBe('deploy');
  });

  it('smoke job calls reusable smoke-test workflow', () => {
    expect(wf.jobs.smoke.uses).toBe('./.github/workflows/smoke-test.yml');
  });

  it('smoke job passes PROD_BASE_URL and strict=true', () => {
    expect(wf.jobs.smoke.with.base_url).toContain('PROD_BASE_URL');
    expect(wf.jobs.smoke.with.strict).toBe(true);
  });
});

describe('cd-prod workflow — security', () => {
  it('uses OIDC for AWS credentials (no static keys)', () => {
    for (const jobName of ['diff', 'deploy']) {
      const awsStep = wf.jobs[jobName].steps.find((s) =>
        s.uses?.startsWith('aws-actions/configure-aws-credentials'),
      );
      expect(awsStep, `${jobName} should configure AWS`).toBeDefined();
      expect(awsStep.with['role-to-assume']).toContain('AWS_DEPLOY_ROLE_ARN');
    }
  });

  it('never contains hardcoded secrets or account IDs', () => {
    const raw = readFileSync('.github/workflows/cd-prod.yml', 'utf8');
    expect(raw).not.toMatch(/AKIA[A-Z0-9]{16}/);
    expect(raw).not.toMatch(/\d{12}/);
  });
});
