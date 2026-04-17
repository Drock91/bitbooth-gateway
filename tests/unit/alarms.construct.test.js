import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Alarms } from '../../infra/stacks/constructs/alarms.js';

function mkTable(stack, name) {
  return new Table(stack, name, {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
    tableName: `test-${name}`,
  });
}

function mkFn(stack, name) {
  return new Function(stack, name, {
    functionName: `test-${name}`,
    runtime: Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {}'),
  });
}

function buildStack(stage = 'dev') {
  const app = new App();
  const stack = new Stack(app, `AlarmsTest-${stage}-${Date.now()}`);

  const tables = {
    all: [
      ['Payments', mkTable(stack, 'Payments')],
      ['Tenants', mkTable(stack, 'Tenants')],
      ['Routes', mkTable(stack, 'Routes')],
      ['Usage', mkTable(stack, 'Usage')],
      ['RateLimit', mkTable(stack, 'RateLimit')],
      ['Idempotency', mkTable(stack, 'Idempotency')],
      ['FraudEvents', mkTable(stack, 'FraudEvents')],
      ['FraudTally', mkTable(stack, 'FraudTally')],
      ['AgentNonces', mkTable(stack, 'AgentNonces')],
      ['WebhookDlq', mkTable(stack, 'WebhookDlq')],
    ],
  };

  const apiFn = mkFn(stack, 'Api');
  const webhookFn = mkFn(stack, 'Webhook');
  const stripeWebhookFn = mkFn(stack, 'StripeWebhook');
  const dashboardFn = mkFn(stack, 'Dashboard');
  const dlqSweepFn = mkFn(stack, 'DlqSweep');
  const fetchFn = mkFn(stack, 'Fetch');

  const webhookDlqQueue = new Queue(stack, 'WebhookDlqQueue');
  const stripeWebhookDlqQueue = new Queue(stack, 'StripeWebhookDlqQueue');

  const lambdas = {
    apiFn,
    webhookFn,
    stripeWebhookFn,
    dashboardFn,
    dlqSweepFn,
    fetchFn,
    webhookDlqQueue,
    stripeWebhookDlqQueue,
    allFns: [
      ['Api', apiFn],
      ['Webhook', webhookFn],
      ['StripeWebhook', stripeWebhookFn],
      ['Dashboard', dashboardFn],
      ['DlqSweep', dlqSweepFn],
      ['Fetch', fetchFn],
    ],
  };

  const api = new RestApi(stack, 'TestApi', { restApiName: 'test-api' });
  api.root.addMethod('GET');
  const apiGw = { api };

  const alarms = new Alarms(stack, 'Alarms', { stage, lambdas, tables, apiGw });
  const template = Template.fromStack(stack);

  return { stack, alarms, template };
}

function allAlarms(template) {
  return template.findResources('AWS::CloudWatch::Alarm');
}

function alarmsByNameFragment(template, fragment) {
  return Object.entries(allAlarms(template)).filter(([, r]) =>
    r.Properties.AlarmName.includes(fragment),
  );
}

// ── SNS Topic ──

describe('Alarms construct — SNS topic', () => {
  const { template } = buildStack('staging');

  it('creates exactly 1 SNS topic', () => {
    template.resourceCountIs('AWS::SNS::Topic', 1);
  });

  it('names the topic with stage', () => {
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'x402-alarms-staging',
      DisplayName: 'x402 staging alarms',
    });
  });
});

// ── Alarm count ──

describe('Alarms construct — alarm count', () => {
  const { template } = buildStack();
  const count = Object.keys(allAlarms(template)).length;

  it('creates exactly 26 alarms', () => {
    expect(count).toBe(26);
  });
});

// ── Lambda error alarms ──

describe('Alarms construct — Lambda error alarms', () => {
  const { template } = buildStack('prod');

  it('creates 6 Lambda error alarms', () => {
    const errAlarms = alarmsByNameFragment(template, '-errors');
    expect(errAlarms.length).toBe(6);
  });

  it.each(['api', 'webhook', 'stripewebhook', 'dashboard', 'dlqsweep', 'fetch'])(
    'creates error alarm for %s',
    (name) => {
      const matches = alarmsByNameFragment(template, `x402-prod-${name}-errors`);
      expect(matches.length).toBe(1);
    },
  );

  it('sets threshold to 5', () => {
    const [, alarm] = alarmsByNameFragment(template, '-errors')[0];
    expect(alarm.Properties.Threshold).toBe(5);
  });

  it('uses 1 evaluation period', () => {
    const [, alarm] = alarmsByNameFragment(template, '-errors')[0];
    expect(alarm.Properties.EvaluationPeriods).toBe(1);
  });

  it('uses GREATER_THAN_OR_EQUAL_TO_THRESHOLD comparison', () => {
    const [, alarm] = alarmsByNameFragment(template, '-errors')[0];
    expect(alarm.Properties.ComparisonOperator).toBe('GreaterThanOrEqualToThreshold');
  });

  it('treats missing data as not breaching', () => {
    const [, alarm] = alarmsByNameFragment(template, '-errors')[0];
    expect(alarm.Properties.TreatMissingData).toBe('notBreaching');
  });

  it('has SNS alarm action', () => {
    const [, alarm] = alarmsByNameFragment(template, '-errors')[0];
    expect(alarm.Properties.AlarmActions).toHaveLength(1);
  });
});

// ── API Gateway 5xx alarm ──

describe('Alarms construct — API GW 5xx alarm', () => {
  const { template } = buildStack('staging');

  it('creates alarm named with stage', () => {
    const matches = alarmsByNameFragment(template, 'apigw-5xx');
    expect(matches.length).toBe(1);
    expect(matches[0][1].Properties.AlarmName).toBe('x402-staging-apigw-5xx');
  });

  it('sets threshold to 10', () => {
    const [, alarm] = alarmsByNameFragment(template, 'apigw-5xx')[0];
    expect(alarm.Properties.Threshold).toBe(10);
  });

  it('has descriptive alarm description', () => {
    const [, alarm] = alarmsByNameFragment(template, 'apigw-5xx')[0];
    expect(alarm.Properties.AlarmDescription).toContain('5xx');
  });

  it('has SNS alarm action', () => {
    const [, alarm] = alarmsByNameFragment(template, 'apigw-5xx')[0];
    expect(alarm.Properties.AlarmActions).toHaveLength(1);
  });
});

// ── API Gateway 4xx alarm ──

describe('Alarms construct — API GW 4xx alarm', () => {
  const { template } = buildStack('prod');

  it('creates alarm named with stage', () => {
    const matches = alarmsByNameFragment(template, 'apigw-4xx');
    expect(matches.length).toBe(1);
    expect(matches[0][1].Properties.AlarmName).toBe('x402-prod-apigw-4xx');
  });

  it('sets threshold to 50', () => {
    const [, alarm] = alarmsByNameFragment(template, 'apigw-4xx')[0];
    expect(alarm.Properties.Threshold).toBe(50);
  });

  it('has descriptive alarm description', () => {
    const [, alarm] = alarmsByNameFragment(template, 'apigw-4xx')[0];
    expect(alarm.Properties.AlarmDescription).toContain('4xx');
  });

  it('treats missing data as not breaching', () => {
    const [, alarm] = alarmsByNameFragment(template, 'apigw-4xx')[0];
    expect(alarm.Properties.TreatMissingData).toBe('notBreaching');
  });
});

// ── DDB throttle alarms ──

describe('Alarms construct — DDB throttle alarms', () => {
  const { template } = buildStack('dev');

  it('creates 10 DDB throttle alarms', () => {
    const throttleAlarms = alarmsByNameFragment(template, 'ddb-');
    expect(throttleAlarms.length).toBe(10);
  });

  it.each([
    'payments',
    'tenants',
    'routes',
    'usage',
    'ratelimit',
    'idempotency',
    'fraudevents',
    'fraudtally',
    'agentnonces',
    'webhookdlq',
  ])('creates throttle alarm for %s table', (name) => {
    const matches = alarmsByNameFragment(template, `ddb-${name}-throttles`);
    expect(matches.length).toBe(1);
  });

  it('sets threshold to 1', () => {
    const [, alarm] = alarmsByNameFragment(template, 'ddb-')[0];
    expect(alarm.Properties.Threshold).toBe(1);
  });

  it('has SNS alarm action on each', () => {
    const throttleAlarms = alarmsByNameFragment(template, 'ddb-');
    for (const [, alarm] of throttleAlarms) {
      expect(alarm.Properties.AlarmActions).toHaveLength(1);
    }
  });

  it('treats missing data as not breaching on each', () => {
    const throttleAlarms = alarmsByNameFragment(template, 'ddb-');
    for (const [, alarm] of throttleAlarms) {
      expect(alarm.Properties.TreatMissingData).toBe('notBreaching');
    }
  });
});

// ── Lambda P99 duration alarms ──

describe('Alarms construct — Lambda P99 duration alarms', () => {
  const { template } = buildStack('prod');

  it('creates 6 P99 duration alarms', () => {
    const p99Alarms = alarmsByNameFragment(template, 'duration-p99');
    expect(p99Alarms.length).toBe(6);
  });

  it.each([
    'x402-prod-api-duration-p99',
    'x402-prod-webhook-duration-p99',
    'x402-prod-stripewebhook-duration-p99',
    'x402-prod-dashboard-duration-p99',
    'x402-prod-dlqsweep-duration-p99',
    'x402-prod-fetch-duration-p99',
  ])('creates P99 alarm %s', (alarmName) => {
    const matches = Object.entries(allAlarms(template)).filter(
      ([, r]) => r.Properties.AlarmName === alarmName,
    );
    expect(matches.length).toBe(1);
  });

  it('sets 8000ms threshold for Api', () => {
    const [, alarm] = alarmsByNameFragment(template, 'api-duration-p99')[0];
    expect(alarm.Properties.Threshold).toBe(8000);
  });

  it('sets 8000ms threshold for Webhook', () => {
    const [, alarm] = Object.entries(allAlarms(template)).find(
      ([, r]) => r.Properties.AlarmName === 'x402-prod-webhook-duration-p99',
    );
    expect(alarm.Properties.Threshold).toBe(8000);
  });

  it('sets 240000ms threshold for DlqSweep', () => {
    const [, alarm] = alarmsByNameFragment(template, 'dlqsweep-duration-p99')[0];
    expect(alarm.Properties.Threshold).toBe(240000);
  });

  it('sets 12000ms threshold for Fetch', () => {
    const [, alarm] = alarmsByNameFragment(template, 'fetch-duration-p99')[0];
    expect(alarm.Properties.Threshold).toBe(12000);
  });

  it('has alarm description mentioning threshold', () => {
    const [, alarm] = alarmsByNameFragment(template, 'dlqsweep-duration-p99')[0];
    expect(alarm.Properties.AlarmDescription).toContain('240000ms');
  });

  it('has SNS alarm action on each', () => {
    const p99Alarms = alarmsByNameFragment(template, 'duration-p99');
    for (const [, alarm] of p99Alarms) {
      expect(alarm.Properties.AlarmActions).toHaveLength(1);
    }
  });
});

// ── SQS DLQ alarms ──

describe('Alarms construct — SQS DLQ alarms', () => {
  const { template } = buildStack('staging');

  it('creates 2 SQS DLQ alarms', () => {
    const dlqAlarms = alarmsByNameFragment(template, 'sqs-');
    expect(dlqAlarms.length).toBe(2);
  });

  it('creates WebhookDlq alarm', () => {
    const matches = alarmsByNameFragment(template, 'sqs-webhookdlq-messages');
    expect(matches.length).toBe(1);
    expect(matches[0][1].Properties.AlarmName).toBe('x402-staging-sqs-webhookdlq-messages');
  });

  it('creates StripeWebhookDlq alarm', () => {
    const matches = alarmsByNameFragment(template, 'sqs-stripewebhookdlq-messages');
    expect(matches.length).toBe(1);
  });

  it('sets threshold to 1', () => {
    const [, alarm] = alarmsByNameFragment(template, 'sqs-')[0];
    expect(alarm.Properties.Threshold).toBe(1);
  });

  it('has descriptive alarm description', () => {
    const [, alarm] = alarmsByNameFragment(template, 'sqs-webhookdlq')[0];
    expect(alarm.Properties.AlarmDescription).toContain('SQS');
  });

  it('has SNS alarm action on each', () => {
    const dlqAlarms = alarmsByNameFragment(template, 'sqs-');
    for (const [, alarm] of dlqAlarms) {
      expect(alarm.Properties.AlarmActions).toHaveLength(1);
    }
  });
});

// ── All alarms share SNS topic ──

describe('Alarms construct — all alarms use same SNS topic', () => {
  const { template } = buildStack();
  const alarms = Object.values(allAlarms(template));

  it('every alarm has exactly 1 alarm action', () => {
    for (const alarm of alarms) {
      expect(alarm.Properties.AlarmActions).toHaveLength(1);
    }
  });

  it('all alarm actions reference the same SNS topic', () => {
    const refs = alarms.map((a) => JSON.stringify(a.Properties.AlarmActions[0]));
    const unique = new Set(refs);
    expect(unique.size).toBe(1);
  });
});

// ── alarmTopic exposed ──

describe('Alarms construct — alarmTopic property', () => {
  const { alarms } = buildStack();

  it('exposes alarmTopic', () => {
    expect(alarms.alarmTopic).toBeDefined();
  });

  it('alarmTopic is an SNS Topic', () => {
    expect(alarms.alarmTopic.topicArn).toBeDefined();
  });
});

// ── Stage naming ──

describe('Alarms construct — stage naming', () => {
  it('uses dev stage in alarm names', () => {
    const { template } = buildStack('dev');
    const matches = alarmsByNameFragment(template, 'x402-dev-');
    expect(matches.length).toBe(26);
  });

  it('uses prod stage in alarm names', () => {
    const { template } = buildStack('prod');
    const matches = alarmsByNameFragment(template, 'x402-prod-');
    expect(matches.length).toBe(26);
  });
});
