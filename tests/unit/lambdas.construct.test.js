import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Lambdas } from '../../infra/stacks/constructs/lambdas.js';

function mkTable(stack, name) {
  return new Table(stack, name, {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
    tableName: `test-${name}`,
  });
}

function mkSecret(stack, name) {
  return new Secret(stack, name, { secretName: `test-${name}` });
}

function buildStack(stage = 'dev') {
  const app = new App();
  const stack = new Stack(app, `LambdasTest-${stage}-${Date.now()}`);

  const tables = {
    payments: mkTable(stack, 'Payments'),
    tenants: mkTable(stack, 'Tenants'),
    routes: mkTable(stack, 'Routes'),
    usage: mkTable(stack, 'Usage'),
    rateLimit: mkTable(stack, 'RateLimit'),
    idempotency: mkTable(stack, 'Idempotency'),
    fraudEvents: mkTable(stack, 'FraudEvents'),
    fraudTally: mkTable(stack, 'FraudTally'),
    agentNonces: mkTable(stack, 'AgentNonces'),
    webhookDlq: mkTable(stack, 'WebhookDlq'),
  };

  const secrets = {
    agentWallet: mkSecret(stack, 'AgentWallet'),
    baseRpc: mkSecret(stack, 'BaseRpc'),
    adminApiKeyHash: mkSecret(stack, 'AdminApiKeyHash'),
    stripeWebhook: mkSecret(stack, 'StripeWebhook'),
  };

  const commonEnv = { STAGE: stage, LOG_LEVEL: 'info' };

  const lambdas = new Lambdas(stack, 'Lambdas', { stage, tables, secrets, commonEnv });
  const template = Template.fromStack(stack);

  return { stack, lambdas, template };
}

function getFunctions(template) {
  const all = template.findResources('AWS::Lambda::Function');
  return Object.entries(all)
    .filter(([, r]) => typeof r.Properties.FunctionName === 'string')
    .map(([id, r]) => ({ id, ...r.Properties }));
}

function findFnByName(template, nameFragment) {
  return getFunctions(template).find((f) => f.FunctionName.includes(nameFragment));
}

// ── Lambda function creation ──

describe('Lambdas construct — function creation', () => {
  const { template } = buildStack();
  const fns = getFunctions(template);

  it('creates exactly 6 Lambda functions', () => {
    expect(fns.length).toBe(6);
  });

  it('names each function with the stage suffix', () => {
    const names = fns.map((f) => f.FunctionName).sort();
    expect(names).toEqual([
      'x402-api-dev',
      'x402-dashboard-dev',
      'x402-dlq-sweep-dev',
      'x402-fetch-dev',
      'x402-stripe-webhook-dev',
      'x402-webhook-dev',
    ]);
  });

  it('names each function with prod stage suffix', () => {
    const { template: prodTpl } = buildStack('prod');
    const prodNames = getFunctions(prodTpl)
      .map((f) => f.FunctionName)
      .sort();
    expect(prodNames).toEqual([
      'x402-api-prod',
      'x402-dashboard-prod',
      'x402-dlq-sweep-prod',
      'x402-fetch-prod',
      'x402-stripe-webhook-prod',
      'x402-webhook-prod',
    ]);
  });
});

// ── Runtime and handler ──

describe('Lambdas construct — runtime and handler', () => {
  const { template } = buildStack();

  it('all functions use Node.js 20.x runtime', () => {
    for (const fn of getFunctions(template)) {
      expect(fn.Runtime).toBe('nodejs20.x');
    }
  });

  // Handler paths are flattened: build.js emits `dist/<name>.js` so the
  // Lambda spec is `<name>.<exportName>` (single dot, unambiguous ESM resolve).
  it('apiFn uses correct handler path', () => {
    const fn = findFnByName(template, 'x402-api-');
    expect(fn.Handler).toBe('api.handler');
  });

  it('webhookFn uses correct handler path', () => {
    const fn = findFnByName(template, 'x402-webhook-dev');
    expect(fn.Handler).toBe('webhook.handler');
  });

  it('stripeWebhookFn uses correct handler path', () => {
    const fn = findFnByName(template, 'x402-stripe-webhook-');
    expect(fn.Handler).toBe('stripe-webhook.default');
  });

  it('dashboardFn uses correct handler path', () => {
    const fn = findFnByName(template, 'x402-dashboard-');
    expect(fn.Handler).toBe('dashboard.handler');
  });

  it('dlqSweepFn uses correct handler path', () => {
    const fn = findFnByName(template, 'x402-dlq-sweep-');
    expect(fn.Handler).toBe('dlq-sweep.handler');
  });

  it('fetchFn uses correct handler path', () => {
    const fn = findFnByName(template, 'x402-fetch-');
    expect(fn.Handler).toBe('fetch.handler');
  });
});

// ── Memory and timeout ──

describe('Lambdas construct — memory and timeout', () => {
  const { template } = buildStack();

  it('apiFn has 512 MB memory', () => {
    const fn = findFnByName(template, 'x402-api-');
    expect(fn.MemorySize).toBe(512);
  });

  it('apiFn has 10s timeout', () => {
    const fn = findFnByName(template, 'x402-api-');
    expect(fn.Timeout).toBe(10);
  });

  it('webhookFn has 256 MB memory', () => {
    const fn = findFnByName(template, 'x402-webhook-dev');
    expect(fn.MemorySize).toBe(256);
  });

  it('dlqSweepFn has 5 minute timeout', () => {
    const fn = findFnByName(template, 'x402-dlq-sweep-');
    expect(fn.Timeout).toBe(300);
  });

  it('dashboardFn has 256 MB memory and 10s timeout', () => {
    const fn = findFnByName(template, 'x402-dashboard-');
    expect(fn.MemorySize).toBe(256);
    expect(fn.Timeout).toBe(10);
  });

  it('fetchFn has 2048 MB memory and 30s timeout for Playwright rendering', () => {
    const fn = findFnByName(template, 'x402-fetch-');
    expect(fn.MemorySize).toBe(2048);
    expect(fn.Timeout).toBe(30);
  });
});

// ── X-Ray tracing ──

describe('Lambdas construct — X-Ray tracing', () => {
  const { template } = buildStack();

  it('all functions have active tracing enabled', () => {
    for (const fn of getFunctions(template)) {
      expect(fn.TracingConfig).toEqual({ Mode: 'Active' });
    }
  });
});

// ── Reserved concurrency ──
//
// Non-prod stages intentionally omit ReservedConcurrentExecutions so they
// don't collide with the default 10-slot account quota on new AWS accounts.
// Only prod pins concurrency.

describe('Lambdas construct — reserved concurrency', () => {
  it('apiFn is unpinned in dev', () => {
    const { template } = buildStack('dev');
    const fn = findFnByName(template, 'x402-api-');
    expect(fn.ReservedConcurrentExecutions).toBeUndefined();
  });

  it('apiFn gets 100 in prod', () => {
    const { template } = buildStack('prod');
    const fn = findFnByName(template, 'x402-api-');
    expect(fn.ReservedConcurrentExecutions).toBe(100);
  });

  it('webhookFn is unpinned in dev, 10 in prod', () => {
    const { template: devTpl } = buildStack('dev');
    const { template: prodTpl } = buildStack('prod');
    expect(findFnByName(devTpl, 'x402-webhook-dev').ReservedConcurrentExecutions).toBeUndefined();
    expect(findFnByName(prodTpl, 'x402-webhook-prod').ReservedConcurrentExecutions).toBe(10);
  });

  it('stripeWebhookFn is unpinned in dev, 10 in prod', () => {
    const { template: devTpl } = buildStack('dev');
    const { template: prodTpl } = buildStack('prod');
    expect(
      findFnByName(devTpl, 'x402-stripe-webhook-dev').ReservedConcurrentExecutions,
    ).toBeUndefined();
    expect(findFnByName(prodTpl, 'x402-stripe-webhook-prod').ReservedConcurrentExecutions).toBe(10);
  });

  it('dashboardFn is unpinned in dev, 10 in prod', () => {
    const { template: devTpl } = buildStack('dev');
    const { template: prodTpl } = buildStack('prod');
    expect(findFnByName(devTpl, 'x402-dashboard-dev').ReservedConcurrentExecutions).toBeUndefined();
    expect(findFnByName(prodTpl, 'x402-dashboard-prod').ReservedConcurrentExecutions).toBe(10);
  });

  it('dlqSweepFn is unpinned in dev, 1 in prod', () => {
    const { template: devTpl } = buildStack('dev');
    const { template: prodTpl } = buildStack('prod');
    expect(findFnByName(devTpl, 'x402-dlq-sweep-dev').ReservedConcurrentExecutions).toBeUndefined();
    expect(findFnByName(prodTpl, 'x402-dlq-sweep-prod').ReservedConcurrentExecutions).toBe(1);
  });

  it('fetchFn is unpinned in dev, 20 in prod', () => {
    const { template: devTpl } = buildStack('dev');
    const { template: prodTpl } = buildStack('prod');
    expect(findFnByName(devTpl, 'x402-fetch-dev').ReservedConcurrentExecutions).toBeUndefined();
    expect(findFnByName(prodTpl, 'x402-fetch-prod').ReservedConcurrentExecutions).toBe(20);
  });
});

// ── Environment variables ──

describe('Lambdas construct — environment', () => {
  const { template } = buildStack();

  it('all functions receive commonEnv variables', () => {
    for (const fn of getFunctions(template)) {
      expect(fn.Environment.Variables.STAGE).toBe('dev');
      expect(fn.Environment.Variables.LOG_LEVEL).toBe('info');
    }
  });
});

// ── Log groups ──

describe('Lambdas construct — log groups', () => {
  it('creates 6 log groups with 30-day retention', () => {
    const { template } = buildStack();
    const logGroups = template.findResources('AWS::Logs::LogGroup');
    const entries = Object.values(logGroups);
    expect(entries.length).toBe(6);
    for (const lg of entries) {
      expect(lg.Properties.RetentionInDays).toBe(30);
    }
  });

  it('log groups use DESTROY removal policy in dev', () => {
    const { template } = buildStack('dev');
    const logGroups = template.findResources('AWS::Logs::LogGroup');
    for (const lg of Object.values(logGroups)) {
      expect(lg.DeletionPolicy).toBe('Delete');
    }
  });

  it('log groups use RETAIN removal policy in prod', () => {
    const { template } = buildStack('prod');
    const logGroups = template.findResources('AWS::Logs::LogGroup');
    for (const lg of Object.values(logGroups)) {
      expect(lg.DeletionPolicy).toBe('Retain');
    }
  });

  it('all functions reference a log group', () => {
    const { template } = buildStack();
    for (const fn of getFunctions(template)) {
      expect(fn.LoggingConfig).toBeDefined();
      expect(fn.LoggingConfig.LogGroup).toBeDefined();
    }
  });
});

// ── SQS dead-letter queues ──

describe('Lambdas construct — SQS DLQs', () => {
  const { template } = buildStack();
  const queues = template.findResources('AWS::SQS::Queue');
  const queueEntries = Object.values(queues);

  it('creates exactly 2 SQS queues', () => {
    expect(queueEntries.length).toBe(2);
  });

  it('webhook DLQ queue is named with stage', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'x402-webhook-dlq-dev',
    });
  });

  it('stripe webhook DLQ queue is named with stage', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'x402-stripe-webhook-dlq-dev',
    });
  });

  it('both queues have 14-day retention', () => {
    for (const q of queueEntries) {
      expect(q.Properties.MessageRetentionPeriod).toBe(1209600);
    }
  });

  it('webhookFn has DLQ configured', () => {
    const fn = findFnByName(template, 'x402-webhook-dev');
    expect(fn.DeadLetterConfig).toBeDefined();
    expect(fn.DeadLetterConfig.TargetArn).toBeDefined();
  });

  it('stripeWebhookFn has DLQ configured', () => {
    const fn = findFnByName(template, 'x402-stripe-webhook-');
    expect(fn.DeadLetterConfig).toBeDefined();
    expect(fn.DeadLetterConfig.TargetArn).toBeDefined();
  });

  it('apiFn does NOT have a DLQ', () => {
    const fn = findFnByName(template, 'x402-api-');
    expect(fn.DeadLetterConfig).toBeUndefined();
  });

  it('dashboardFn does NOT have a DLQ', () => {
    const fn = findFnByName(template, 'x402-dashboard-');
    expect(fn.DeadLetterConfig).toBeUndefined();
  });

  it('dlqSweepFn does NOT have a DLQ', () => {
    const fn = findFnByName(template, 'x402-dlq-sweep-');
    expect(fn.DeadLetterConfig).toBeUndefined();
  });

  it('fetchFn does NOT have a DLQ', () => {
    const fn = findFnByName(template, 'x402-fetch-');
    expect(fn.DeadLetterConfig).toBeUndefined();
  });
});

// ── EventBridge schedule ──

describe('Lambdas construct — EventBridge schedule', () => {
  const { template } = buildStack();

  it('creates a scheduled rule for DLQ sweep', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(5 minutes)',
      Description: 'Trigger DLQ sweep every 5 minutes',
    });
  });

  it('schedule rule is named with stage', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'x402-dlq-sweep-dev',
    });
  });

  it('schedule rule targets the dlqSweepFn', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: Match.arrayWith([
        Match.objectLike({
          Arn: Match.anyValue(),
        }),
      ]),
    });
  });

  it('creates exactly 1 EventBridge rule', () => {
    const rules = template.findResources('AWS::Events::Rule');
    expect(Object.keys(rules).length).toBe(1);
  });
});

// ── IAM grants ──

describe('Lambdas construct — IAM grants', () => {
  const { template } = buildStack();
  const policies = template.findResources('AWS::IAM::Policy');
  const policyEntries = Object.entries(policies);

  function findPoliciesForFn(fnNameFragment) {
    return policyEntries.filter(([id]) => id.toLowerCase().includes(fnNameFragment.toLowerCase()));
  }

  function extractActions(policyResource) {
    const statements = policyResource.Properties.PolicyDocument.Statement;
    return statements.flatMap((s) => s.Action);
  }

  it('dlqSweepFn gets DynamoDB read/write on webhookDlq table', () => {
    const sweepPolicies = findPoliciesForFn('DlqSweep');
    const allActions = sweepPolicies.flatMap(([, p]) => extractActions(p));
    expect(allActions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:PutItem']));
  });

  it('dlqSweepFn gets DynamoDB access on webhookDlq', () => {
    const sweepPolicies = findPoliciesForFn('DlqSweep');
    const allActions = sweepPolicies.flatMap(([, p]) => extractActions(p));
    expect(allActions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:PutItem']));
  });

  it('apiFn gets DynamoDB access on 9 tables', () => {
    const apiPolicies = findPoliciesForFn('ApiFn');
    const allActions = apiPolicies.flatMap(([, p]) => extractActions(p));
    expect(allActions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:PutItem']));
  });

  it('apiFn gets Secrets Manager read on agentWallet, baseRpc, adminApiKeyHash', () => {
    const apiPolicies = findPoliciesForFn('ApiFn');
    const allActions = apiPolicies.flatMap(([, p]) => extractActions(p));
    expect(allActions).toEqual(expect.arrayContaining(['secretsmanager:GetSecretValue']));
  });

  it('dashboardFn gets DynamoDB access on payments, tenants, routes, usage, rateLimit', () => {
    const dashPolicies = findPoliciesForFn('DashboardFn');
    const allActions = dashPolicies.flatMap(([, p]) => extractActions(p));
    expect(allActions).toEqual(expect.arrayContaining(['dynamodb:GetItem']));
  });

  it('webhookFn gets DynamoDB access on tenants and webhookDlq', () => {
    const webhookPolicies = findPoliciesForFn('WebhookFn');
    const allActions = webhookPolicies.flatMap(([, p]) => extractActions(p));
    expect(allActions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:PutItem']));
  });

  it('webhookFn gets Secrets Manager read on stripeWebhook', () => {
    const webhookPolicies = findPoliciesForFn('WebhookFn');
    const allActions = webhookPolicies.flatMap(([, p]) => extractActions(p));
    expect(allActions).toEqual(expect.arrayContaining(['secretsmanager:GetSecretValue']));
  });

  it('stripeWebhookFn gets DynamoDB access on tenants', () => {
    const stripePolicies = findPoliciesForFn('StripeWebhookFn');
    const allActions = stripePolicies.flatMap(([, p]) => extractActions(p));
    expect(allActions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:PutItem']));
  });

  it('stripeWebhookFn gets Secrets Manager read on stripeWebhook', () => {
    const stripePolicies = findPoliciesForFn('StripeWebhookFn');
    const allActions = stripePolicies.flatMap(([, p]) => extractActions(p));
    expect(allActions).toEqual(expect.arrayContaining(['secretsmanager:GetSecretValue']));
  });

  it('fetchFn gets DynamoDB read on routes, agentNonces, payments, usage', () => {
    const fetchPolicies = findPoliciesForFn('FetchFn');
    const allActions = fetchPolicies.flatMap(([, p]) => extractActions(p));
    expect(allActions).toEqual(expect.arrayContaining(['dynamodb:GetItem']));
  });

  it('fetchFn gets DynamoDB read/write on rateLimit and idempotency', () => {
    const fetchPolicies = findPoliciesForFn('FetchFn');
    const allActions = fetchPolicies.flatMap(([, p]) => extractActions(p));
    expect(allActions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:PutItem']));
  });

  it('fetchFn gets Secrets Manager read on agentWallet and baseRpc', () => {
    const fetchPolicies = findPoliciesForFn('FetchFn');
    const allActions = fetchPolicies.flatMap(([, p]) => extractActions(p));
    expect(allActions).toEqual(expect.arrayContaining(['secretsmanager:GetSecretValue']));
  });
});

// ── allFns output ──

describe('Lambdas construct — allFns output', () => {
  const { lambdas } = buildStack();

  it('exposes allFns with 6 entries', () => {
    expect(lambdas.allFns.length).toBe(6);
  });

  it('allFns entries are [name, fn] tuples', () => {
    const names = lambdas.allFns.map(([name]) => name).sort();
    expect(names).toEqual(['Api', 'Dashboard', 'DlqSweep', 'Fetch', 'StripeWebhook', 'Webhook']);
  });

  it('allFns second elements are Lambda Function constructs', () => {
    for (const [, fn] of lambdas.allFns) {
      expect(fn.functionArn).toBeDefined();
      expect(fn.functionName).toBeDefined();
    }
  });
});

// ── Exposed properties ──

describe('Lambdas construct — exposed properties', () => {
  const { lambdas } = buildStack();

  it('exposes apiFn, webhookFn, stripeWebhookFn, dashboardFn, dlqSweepFn, fetchFn', () => {
    expect(lambdas.apiFn).toBeDefined();
    expect(lambdas.webhookFn).toBeDefined();
    expect(lambdas.stripeWebhookFn).toBeDefined();
    expect(lambdas.dashboardFn).toBeDefined();
    expect(lambdas.dlqSweepFn).toBeDefined();
    expect(lambdas.fetchFn).toBeDefined();
  });

  it('exposes webhookDlqQueue and stripeWebhookDlqQueue', () => {
    expect(lambdas.webhookDlqQueue).toBeDefined();
    expect(lambdas.stripeWebhookDlqQueue).toBeDefined();
  });

  it('queue ARNs are resolvable', () => {
    expect(lambdas.webhookDlqQueue.queueArn).toBeDefined();
    expect(lambdas.stripeWebhookDlqQueue.queueArn).toBeDefined();
  });
});
