import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

let wf;
let raw;

beforeAll(() => {
  raw = readFileSync('.github/workflows/cd-staging.yml', 'utf8');
  wf = parse(raw);
});

describe('cd-staging workflow — triggers', () => {
  it('is named cd-staging', () => {
    expect(wf.name).toBe('cd-staging');
  });

  it('triggers from a successful ci workflow_run on main', () => {
    expect(wf.on.workflow_run.workflows).toEqual(['ci']);
    expect(wf.on.workflow_run.types).toEqual(['completed']);
    expect(wf.on.workflow_run.branches).toEqual(['main']);
  });
});

describe('cd-staging workflow — permissions', () => {
  it('requests OIDC id-token write permission', () => {
    expect(wf.permissions['id-token']).toBe('write');
  });

  it('requests contents read permission only', () => {
    expect(wf.permissions.contents).toBe('read');
  });

  it('has exactly 2 permission scopes (least-privilege)', () => {
    expect(Object.keys(wf.permissions)).toHaveLength(2);
  });
});

describe('cd-staging workflow — deploy job', () => {
  it('deploys only when the upstream ci run succeeded', () => {
    expect(wf.jobs.deploy.if).toContain("github.event.workflow_run.conclusion == 'success'");
  });

  it('runs in the staging environment', () => {
    expect(wf.jobs.deploy.environment).toBe('staging');
  });

  it('uses concurrency group cd-staging without cancelling in-progress deploys', () => {
    expect(wf.jobs.deploy.concurrency.group).toBe('cd-staging');
    expect(wf.jobs.deploy.concurrency['cancel-in-progress']).toBe(false);
  });

  it('checks out the exact head_sha that triggered the upstream ci run', () => {
    const checkout = wf.jobs.deploy.steps.find((s) => s.uses?.startsWith('actions/checkout'));
    expect(checkout).toBeDefined();
    expect(checkout.with.ref).toContain('github.event.workflow_run.head_sha');
  });

  it('sets up node 20 with npm cache', () => {
    const setup = wf.jobs.deploy.steps.find((s) => s.uses?.startsWith('actions/setup-node'));
    expect(setup.with['node-version']).toBe('20');
    expect(setup.with.cache).toBe('npm');
  });

  it('installs deps and builds before deploying', () => {
    const stepIndex = (cmd) => wf.jobs.deploy.steps.findIndex((s) => s.run === cmd);
    const ciIdx = stepIndex('npm ci');
    const buildIdx = stepIndex('npm run build');
    expect(ciIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(ciIdx);
  });
});

describe('cd-staging workflow — AWS credentials', () => {
  let awsStep;

  beforeAll(() => {
    awsStep = wf.jobs.deploy.steps.find((s) =>
      s.uses?.startsWith('aws-actions/configure-aws-credentials'),
    );
  });

  it('configures AWS credentials via OIDC role assumption', () => {
    expect(awsStep).toBeDefined();
    expect(awsStep.with['role-to-assume']).toContain('AWS_DEPLOY_ROLE_ARN');
  });

  it('falls back to us-east-1 when AWS_REGION var is unset', () => {
    expect(awsStep.with['aws-region']).toContain("vars.AWS_REGION || 'us-east-1'");
  });

  it('does not embed long-lived AWS access keys', () => {
    expect(awsStep.with['aws-access-key-id']).toBeUndefined();
    expect(awsStep.with['aws-secret-access-key']).toBeUndefined();
  });
});

describe('cd-staging workflow — CDK steps', () => {
  it('runs cdk diff with STAGE=staging before deploying', () => {
    const diffStep = wf.jobs.deploy.steps.find((s) => s.name === 'CDK diff');
    expect(diffStep).toBeDefined();
    expect(diffStep.run).toBe('npm run cdk:diff');
    expect(diffStep.env.STAGE).toBe('staging');
  });

  it('runs cdk:deploy:staging with STAGE=staging', () => {
    const deployStep = wf.jobs.deploy.steps.find((s) => s.name === 'CDK deploy staging');
    expect(deployStep).toBeDefined();
    expect(deployStep.run).toBe('npm run cdk:deploy:staging');
    expect(deployStep.env.STAGE).toBe('staging');
  });

  it('passes CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION env vars to deploy', () => {
    const deployStep = wf.jobs.deploy.steps.find((s) => s.name === 'CDK deploy staging');
    expect(deployStep.env.CDK_DEFAULT_ACCOUNT).toContain('AWS_ACCOUNT_ID');
    expect(deployStep.env.CDK_DEFAULT_REGION).toContain('AWS_REGION');
  });

  it('runs the diff step before the deploy step', () => {
    const stepNames = wf.jobs.deploy.steps.map((s) => s.name);
    const diffIdx = stepNames.indexOf('CDK diff');
    const deployIdx = stepNames.indexOf('CDK deploy staging');
    expect(diffIdx).toBeGreaterThan(-1);
    expect(deployIdx).toBeGreaterThan(diffIdx);
  });
});

describe('cd-staging workflow — smoke job', () => {
  it('needs the deploy job to complete first', () => {
    expect(wf.jobs.smoke.needs).toBe('deploy');
  });

  it('calls the reusable smoke-test workflow', () => {
    expect(wf.jobs.smoke.uses).toBe('./.github/workflows/smoke-test.yml');
  });

  it('passes the staging base URL and strict=true', () => {
    expect(wf.jobs.smoke.with.base_url).toContain('STAGING_BASE_URL');
    expect(wf.jobs.smoke.with.strict).toBe(true);
  });
});

describe('cd-staging workflow — security', () => {
  it('never contains hardcoded secrets or 12-digit account IDs', () => {
    expect(raw).not.toMatch(/AKIA[A-Z0-9]{16}/);
    expect(raw).not.toMatch(/\b\d{12}\b/);
  });

  it('uses only pinned major-version actions (no @main, no @latest)', () => {
    const allUses = [...wf.jobs.deploy.steps]
      .filter((s) => s.uses && !s.uses.startsWith('./'))
      .map((s) => s.uses);
    for (const u of allUses) {
      expect(u).not.toMatch(/@(main|master|latest)$/);
      expect(u).toMatch(/@v\d+/);
    }
  });
});
