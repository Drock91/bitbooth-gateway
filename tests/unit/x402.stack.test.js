import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { X402Stack } from '../../infra/stacks/x402.stack.js';

function buildTemplate(stage = 'dev') {
  const app = new App();
  const stack = new X402Stack(app, `Test-${stage}`, {
    stage,
    env: { account: '123456789012', region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

function extractCorsOrigins(template) {
  const methods = template.findResources('AWS::ApiGateway::Method', {
    Properties: { HttpMethod: 'OPTIONS' },
  });
  const first = Object.values(methods)[0];
  const resp = first?.Properties?.Integration?.IntegrationResponses?.[0];
  const defaultOrigin =
    resp?.ResponseParameters?.['method.response.header.Access-Control-Allow-Origin'];
  const vtl = resp?.ResponseTemplates?.['application/json'] || '';
  return { defaultOrigin, vtl };
}

describe('X402Stack — log retention', () => {
  const template = buildTemplate();

  it('creates 7 explicit log groups with 30-day retention', () => {
    const logGroups = template.findResources('AWS::Logs::LogGroup');
    const entries = Object.values(logGroups);
    expect(entries.length).toBe(7);
    for (const resource of entries) {
      expect(resource.Properties.RetentionInDays).toBe(30);
    }
  });

  it('log groups use DESTROY removal policy in dev stage', () => {
    const logGroups = template.findResources('AWS::Logs::LogGroup');
    for (const resource of Object.values(logGroups)) {
      expect(resource.DeletionPolicy).toBe('Delete');
    }
  });

  it('log groups use RETAIN removal policy in prod stage', () => {
    const prodTemplate = buildTemplate('prod');
    const logGroups = prodTemplate.findResources('AWS::Logs::LogGroup');
    for (const resource of Object.values(logGroups)) {
      expect(resource.DeletionPolicy).toBe('Retain');
    }
  });
});

describe('X402Stack — Lambda functions', () => {
  const template = buildTemplate();

  it('creates 6 application Lambda functions with stage in name', () => {
    const allFns = template.findResources('AWS::Lambda::Function');
    const appFns = Object.values(allFns).filter(
      (r) => typeof r.Properties.FunctionName === 'string',
    );
    expect(appFns.length).toBe(6);
    for (const fn of appFns) {
      expect(fn.Properties.FunctionName).toContain('-dev');
    }
  });

  it('all application functions reference a log group', () => {
    const allFns = template.findResources('AWS::Lambda::Function');
    const appFns = Object.values(allFns).filter(
      (r) => typeof r.Properties.FunctionName === 'string',
    );
    for (const fn of appFns) {
      expect(fn.Properties.LoggingConfig).toBeDefined();
      expect(fn.Properties.LoggingConfig.LogGroup).toBeDefined();
    }
  });
});

describe('X402Stack — CORS allowOrigins', () => {
  let savedOrigins;

  beforeEach(() => {
    savedOrigins = process.env.ALLOWED_ORIGINS;
  });

  afterEach(() => {
    if (savedOrigins === undefined) {
      delete process.env.ALLOWED_ORIGINS;
    } else {
      process.env.ALLOWED_ORIGINS = savedOrigins;
    }
  });

  it('defaults to wildcard origin when ALLOWED_ORIGINS is unset', () => {
    delete process.env.ALLOWED_ORIGINS;
    const tpl = buildTemplate('cors-default');
    const { defaultOrigin } = extractCorsOrigins(tpl);
    expect(defaultOrigin).toBe("'*'");
  });

  it('uses first custom origin as default and additional in VTL', () => {
    process.env.ALLOWED_ORIGINS = 'https://app.example.com,https://admin.example.com';
    const tpl = buildTemplate('cors-custom');
    const { defaultOrigin, vtl } = extractCorsOrigins(tpl);
    expect(defaultOrigin).toBe("'https://app.example.com'");
    expect(vtl).toContain('https://admin.example.com');
  });

  it('trims whitespace in ALLOWED_ORIGINS entries', () => {
    process.env.ALLOWED_ORIGINS = ' https://a.io , https://b.io ';
    const tpl = buildTemplate('cors-trim');
    const { defaultOrigin, vtl } = extractCorsOrigins(tpl);
    expect(defaultOrigin).toBe("'https://a.io'");
    expect(vtl).toContain('https://b.io');
  });

  it('ignores empty segments in ALLOWED_ORIGINS', () => {
    process.env.ALLOWED_ORIGINS = 'https://x.io,,https://y.io,';
    const tpl = buildTemplate('cors-empty');
    const { defaultOrigin, vtl } = extractCorsOrigins(tpl);
    expect(defaultOrigin).toBe("'https://x.io'");
    expect(vtl).toContain('https://y.io');
  });

  it('passes single origin through correctly', () => {
    process.env.ALLOWED_ORIGINS = 'https://only.example.com';
    const tpl = buildTemplate('cors-single');
    const { defaultOrigin } = extractCorsOrigins(tpl);
    expect(defaultOrigin).toBe("'https://only.example.com'");
  });

  it('sets ALLOWED_ORIGINS in Lambda commonEnv', () => {
    process.env.ALLOWED_ORIGINS = 'https://a.io,https://b.io';
    const tpl = buildTemplate('cors-env');
    tpl.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          ALLOWED_ORIGINS: 'https://a.io,https://b.io',
        },
      },
    });
  });

  it('sets ALLOWED_ORIGINS to * in commonEnv when unset', () => {
    delete process.env.ALLOWED_ORIGINS;
    const tpl = buildTemplate('cors-env-default');
    tpl.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          ALLOWED_ORIGINS: '*',
        },
      },
    });
  });
});

function collectApiMethods(template) {
  const methods = template.findResources('AWS::ApiGateway::Method');
  const results = [];
  for (const [logicalId, resource] of Object.entries(methods)) {
    if (resource.Properties.HttpMethod === 'OPTIONS') continue;
    results.push({
      logicalId,
      httpMethod: resource.Properties.HttpMethod,
      apiKeyRequired: resource.Properties.ApiKeyRequired || false,
      integration: resource.Properties.Integration,
    });
  }
  return results;
}

describe('X402Stack — API Gateway routes', () => {
  const template = buildTemplate();
  const methods = collectApiMethods(template);

  it('has GET /v1/health route', () => {
    const match = methods.find(
      (m) =>
        m.logicalId.includes('health') &&
        !m.logicalId.toLowerCase().includes('ready') &&
        m.httpMethod === 'GET',
    );
    expect(match).toBeDefined();
    expect(match.apiKeyRequired).toBe(false);
  });

  it('has GET /v1/health/ready route', () => {
    const match = methods.find(
      (m) => m.logicalId.toLowerCase().includes('ready') && m.httpMethod === 'GET',
    );
    expect(match).toBeDefined();
    expect(match.apiKeyRequired).toBe(false);
  });

  // /v1/quote unrouted (exchange adapters were stubs); test removed.

  it('has POST /v1/resource route without apiKeyRequired (Lambda auth handles it)', () => {
    const match = methods.find((m) => m.logicalId.includes('resource') && m.httpMethod === 'POST');
    expect(match).toBeDefined();
    expect(match.apiKeyRequired).toBe(false);
  });

  it('has GET /v1/payments route without apiKeyRequired (Lambda auth handles it)', () => {
    const match = methods.find((m) => m.logicalId.includes('payments') && m.httpMethod === 'GET');
    expect(match).toBeDefined();
    expect(match.apiKeyRequired).toBe(false);
  });

  it('has GET /dashboard/routes route', () => {
    const dashRoutes = methods.filter((m) => m.logicalId.toLowerCase().includes('dashboardroutes'));
    const get = dashRoutes.find((m) => m.httpMethod === 'GET');
    expect(get).toBeDefined();
  });

  it('has PUT /dashboard/routes route', () => {
    const dashRoutes = methods.filter((m) => m.logicalId.toLowerCase().includes('dashboardroutes'));
    const put = dashRoutes.find((m) => m.httpMethod === 'PUT');
    expect(put).toBeDefined();
  });

  it('has DELETE /dashboard/routes route', () => {
    const dashRoutes = methods.filter((m) => m.logicalId.toLowerCase().includes('dashboardroutes'));
    const del = dashRoutes.find((m) => m.httpMethod === 'DELETE');
    expect(del).toBeDefined();
  });

  it('has POST /dashboard/signup route', () => {
    const match = methods.find((m) => m.logicalId.includes('signup') && m.httpMethod === 'POST');
    expect(match).toBeDefined();
  });

  it('has POST /dashboard/rotate-key route', () => {
    const match = methods.find(
      (m) => m.logicalId.toLowerCase().includes('rotatekey') && m.httpMethod === 'POST',
    );
    expect(match).toBeDefined();
  });

  it('has GET /admin/tenants route without apiKeyRequired (Lambda admin middleware handles it)', () => {
    const match = methods.find(
      (m) =>
        m.logicalId.toLowerCase().includes('admin') &&
        m.logicalId.toLowerCase().includes('tenants') &&
        m.httpMethod === 'GET',
    );
    expect(match).toBeDefined();
    expect(match.apiKeyRequired).toBe(false);
  });
});

describe('X402Stack — X-Ray tracing', () => {
  const template = buildTemplate();

  it('enables active X-Ray tracing on all 6 Lambda functions', () => {
    const allFns = template.findResources('AWS::Lambda::Function');
    const appFns = Object.values(allFns).filter(
      (r) => typeof r.Properties.FunctionName === 'string',
    );
    expect(appFns.length).toBe(6);
    for (const fn of appFns) {
      expect(fn.Properties.TracingConfig).toEqual({ Mode: 'Active' });
    }
  });

  it('grants xray:PutTraceSegments and xray:PutTelemetryRecords to Lambda roles', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const allStatements = Object.values(policies).flatMap(
      (r) => r.Properties.PolicyDocument?.Statement || [],
    );
    const xrayStatements = allStatements.filter(
      (s) => Array.isArray(s.Action) && s.Action.includes('xray:PutTraceSegments'),
    );
    expect(xrayStatements.length).toBeGreaterThanOrEqual(6);
    for (const stmt of xrayStatements) {
      expect(stmt.Action).toContain('xray:PutTelemetryRecords');
      expect(stmt.Effect).toBe('Allow');
    }
  });

  it('enables X-Ray tracing on API Gateway deployment stage', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      TracingEnabled: true,
    });
  });
});

describe('X402Stack — IAM grants', () => {
  const template = buildTemplate();

  it('grants dashboardFn read/write on routes table', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const dashboardPolicies = Object.entries(policies).filter(([id]) =>
      id.toLowerCase().includes('dashboard'),
    );
    const allStatements = dashboardPolicies.flatMap(
      ([, r]) => r.Properties.PolicyDocument?.Statement || [],
    );
    const actions = allStatements.flatMap((s) => s.Action || []);
    expect(actions).toContain('dynamodb:BatchGetItem');
    expect(actions).toContain('dynamodb:PutItem');
  });

  it('grants apiFn read on adminApiKeyHashSecret', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const apiPolicies = Object.entries(policies).filter(([id]) =>
      id.toLowerCase().includes('apifn'),
    );
    const allStatements = apiPolicies.flatMap(
      ([, r]) => r.Properties.PolicyDocument?.Statement || [],
    );
    const actions = allStatements.flatMap((s) => s.Action || []);
    expect(actions).toContain('secretsmanager:GetSecretValue');
  });
});

describe('X402Stack — admin API key hash secret', () => {
  const template = buildTemplate();

  it('creates AdminApiKeyHashSecret in Secrets Manager', () => {
    const secrets = template.findResources('AWS::SecretsManager::Secret');
    const adminSecret = Object.values(secrets).find(
      (s) => s.Properties.Name === 'x402/dev/admin-api-key-hash',
    );
    expect(adminSecret).toBeDefined();
    expect(adminSecret.Properties.Description).toContain('admin');
  });

  it('includes ADMIN_API_KEY_HASH_SECRET_ARN in Lambda env', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          ADMIN_API_KEY_HASH_SECRET_ARN: Match.anyValue(),
        }),
      },
    });
  });
});

describe('X402Stack — reserved concurrency', () => {
  it('omits ReservedConcurrentExecutions for all fns in dev stage', () => {
    // Non-prod stages don't pin concurrency — default 10-slot account quota
    // on new accounts would reject a positive value.
    const template = buildTemplate('dev');
    const allFns = template.findResources('AWS::Lambda::Function');
    const appFns = Object.values(allFns).filter(
      (r) => typeof r.Properties.FunctionName === 'string',
    );
    for (const fn of appFns) {
      expect(fn.Properties.ReservedConcurrentExecutions).toBeUndefined();
    }
  });

  it('sets apiFn to 100 in prod stage', () => {
    const template = buildTemplate('prod');
    const allFns = template.findResources('AWS::Lambda::Function');
    const apiFn = Object.values(allFns).find((r) => r.Properties.FunctionName === 'x402-api-prod');
    expect(apiFn.Properties.ReservedConcurrentExecutions).toBe(100);
  });

  it('sets webhook, stripe-webhook, and dashboard to 10 in prod stage', () => {
    const template = buildTemplate('prod');
    const allFns = template.findResources('AWS::Lambda::Function');
    const nonApiFns = Object.values(allFns).filter(
      (r) =>
        typeof r.Properties.FunctionName === 'string' &&
        r.Properties.FunctionName !== 'x402-api-prod' &&
        !r.Properties.FunctionName.includes('dlq-sweep') &&
        !r.Properties.FunctionName.includes('fetch'),
    );
    expect(nonApiFns.length).toBe(3);
    for (const fn of nonApiFns) {
      expect(fn.Properties.ReservedConcurrentExecutions).toBe(10);
    }
  });

  it('sets dlqSweepFn to 1 in prod stage', () => {
    const template = buildTemplate('prod');
    const allFns = template.findResources('AWS::Lambda::Function');
    const dlqFn = Object.values(allFns).find(
      (r) => r.Properties.FunctionName === 'x402-dlq-sweep-prod',
    );
    expect(dlqFn.Properties.ReservedConcurrentExecutions).toBe(1);
  });
});

describe('X402Stack — method-level throttling', () => {
  const template = buildTemplate();

  it('sets stage-level default throttling', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          HttpMethod: '*',
          ResourcePath: '/*',
          ThrottlingBurstLimit: 50,
          ThrottlingRateLimit: 25,
        }),
      ]),
    });
  });

  // /v1/quote throttle test removed with /v1/quote unrouting.

  it('throttles POST /v1/resource to 5 rps with burst 10', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          HttpMethod: 'POST',
          ResourcePath: '/~1v1~1resource',
          ThrottlingBurstLimit: 10,
          ThrottlingRateLimit: 5,
        }),
      ]),
    });
  });
});

describe('X402Stack — signup rate limit config', () => {
  const template = buildTemplate();

  it('includes SIGNUP_RATE_LIMIT_CAPACITY in Lambda env', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          SIGNUP_RATE_LIMIT_CAPACITY: '5',
        },
      },
    });
  });

  it('includes SIGNUP_RATE_LIMIT_REFILL_RATE in Lambda env', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          SIGNUP_RATE_LIMIT_REFILL_RATE: String(5 / 3600),
        },
      },
    });
  });

  it('includes HEALTH_RATE_LIMIT_CAPACITY in Lambda env', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          HEALTH_RATE_LIMIT_CAPACITY: '60',
        },
      },
    });
  });

  it('includes HEALTH_RATE_LIMIT_REFILL_RATE in Lambda env', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          HEALTH_RATE_LIMIT_REFILL_RATE: String(60 / 3600),
        },
      },
    });
  });
});

describe('X402Stack — SQS dead-letter queues', () => {
  const template = buildTemplate();

  it('creates 2 SQS queues with stage-suffixed names', () => {
    const queues = template.findResources('AWS::SQS::Queue');
    const queueEntries = Object.values(queues);
    expect(queueEntries.length).toBe(2);
    const names = queueEntries.map((q) => q.Properties.QueueName).sort();
    expect(names).toEqual(['x402-stripe-webhook-dlq-dev', 'x402-webhook-dlq-dev']);
  });

  it('sets 14-day message retention on both queues', () => {
    const queues = template.findResources('AWS::SQS::Queue');
    for (const queue of Object.values(queues)) {
      expect(queue.Properties.MessageRetentionPeriod).toBe(1209600);
    }
  });

  it('wires webhookFn to webhook DLQ', () => {
    const allFns = template.findResources('AWS::Lambda::Function');
    const webhookFn = Object.values(allFns).find(
      (r) => r.Properties.FunctionName === 'x402-webhook-dev',
    );
    expect(webhookFn.Properties.DeadLetterConfig).toBeDefined();
    expect(webhookFn.Properties.DeadLetterConfig.TargetArn).toBeDefined();
  });

  it('wires stripeWebhookFn to stripe webhook DLQ', () => {
    const allFns = template.findResources('AWS::Lambda::Function');
    const stripeFn = Object.values(allFns).find(
      (r) => r.Properties.FunctionName === 'x402-stripe-webhook-dev',
    );
    expect(stripeFn.Properties.DeadLetterConfig).toBeDefined();
    expect(stripeFn.Properties.DeadLetterConfig.TargetArn).toBeDefined();
  });

  it('does NOT wire apiFn or dashboardFn to a DLQ', () => {
    const allFns = template.findResources('AWS::Lambda::Function');
    const apiFn = Object.values(allFns).find((r) => r.Properties.FunctionName === 'x402-api-dev');
    const dashFn = Object.values(allFns).find(
      (r) => r.Properties.FunctionName === 'x402-dashboard-dev',
    );
    expect(apiFn.Properties.DeadLetterConfig).toBeUndefined();
    expect(dashFn.Properties.DeadLetterConfig).toBeUndefined();
  });

  it('creates CloudWatch alarms for both DLQs', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const dlqAlarms = Object.entries(alarms).filter(([id]) => id.includes('DlqAlarm'));
    expect(dlqAlarms.length).toBe(2);
    for (const [, alarm] of dlqAlarms) {
      expect(alarm.Properties.Threshold).toBe(1);
      expect(alarm.Properties.EvaluationPeriods).toBe(1);
    }
  });
});

describe('X402Stack — API GW 4xx alarm', () => {
  const template = buildTemplate();

  it('creates an API GW 4xx alarm with threshold 50', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const alarm4xx = Object.values(alarms).find(
      (a) => a.Properties.AlarmName === 'x402-dev-apigw-4xx',
    );
    expect(alarm4xx).toBeDefined();
    expect(alarm4xx.Properties.Threshold).toBe(50);
    expect(alarm4xx.Properties.EvaluationPeriods).toBe(1);
    expect(alarm4xx.Properties.ComparisonOperator).toBe('GreaterThanOrEqualToThreshold');
    expect(alarm4xx.Properties.TreatMissingData).toBe('notBreaching');
  });

  it('4xx alarm has SNS action', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const alarm4xx = Object.values(alarms).find(
      (a) => a.Properties.AlarmName === 'x402-dev-apigw-4xx',
    );
    expect(alarm4xx.Properties.AlarmActions).toBeDefined();
    expect(alarm4xx.Properties.AlarmActions.length).toBe(1);
  });

  it('4xx alarm uses 5-minute period with Sum statistic', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const alarm4xx = Object.values(alarms).find(
      (a) => a.Properties.AlarmName === 'x402-dev-apigw-4xx',
    );
    expect(alarm4xx.Properties.Period).toBe(300);
    expect(alarm4xx.Properties.Statistic).toBe('Sum');
  });
});

describe('X402Stack — Lambda duration P99 alarms', () => {
  const template = buildTemplate();

  it('creates P99 duration alarms for all 6 Lambda functions', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const durationAlarms = Object.values(alarms).filter(
      (a) => a.Properties.AlarmName && a.Properties.AlarmName.includes('duration-p99'),
    );
    expect(durationAlarms.length).toBe(6);
  });

  it('sets 8000ms threshold for user-facing functions', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    for (const name of ['api', 'webhook', 'stripewebhook', 'dashboard']) {
      const alarm = Object.values(alarms).find(
        (a) => a.Properties.AlarmName === `x402-dev-${name}-duration-p99`,
      );
      expect(alarm).toBeDefined();
      expect(alarm.Properties.Threshold).toBe(8000);
    }
  });

  it('sets 240000ms threshold for dlqSweep function', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const alarm = Object.values(alarms).find(
      (a) => a.Properties.AlarmName === 'x402-dev-dlqsweep-duration-p99',
    );
    expect(alarm).toBeDefined();
    expect(alarm.Properties.Threshold).toBe(240000);
  });

  it('all duration P99 alarms use p99 extended statistic', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const durationAlarms = Object.values(alarms).filter(
      (a) => a.Properties.AlarmName && a.Properties.AlarmName.includes('duration-p99'),
    );
    for (const alarm of durationAlarms) {
      expect(alarm.Properties.ExtendedStatistic).toBe('p99');
      expect(alarm.Properties.Period).toBe(300);
    }
  });

  it('all duration P99 alarms have SNS actions', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const durationAlarms = Object.values(alarms).filter(
      (a) => a.Properties.AlarmName && a.Properties.AlarmName.includes('duration-p99'),
    );
    for (const alarm of durationAlarms) {
      expect(alarm.Properties.AlarmActions).toBeDefined();
      expect(alarm.Properties.AlarmActions.length).toBe(1);
    }
  });

  it('all duration P99 alarms treat missing data as not breaching', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const durationAlarms = Object.values(alarms).filter(
      (a) => a.Properties.AlarmName && a.Properties.AlarmName.includes('duration-p99'),
    );
    for (const alarm of durationAlarms) {
      expect(alarm.Properties.TreatMissingData).toBe('notBreaching');
    }
  });
});

describe('X402Stack — DLQ sweep', () => {
  const template = buildTemplate();

  it('creates dlq-sweep Lambda function', () => {
    const allFns = template.findResources('AWS::Lambda::Function');
    const dlqFn = Object.values(allFns).find(
      (r) => r.Properties.FunctionName === 'x402-dlq-sweep-dev',
    );
    expect(dlqFn).toBeDefined();
    expect(dlqFn.Properties.Handler).toBe('dlq-sweep.handler');
    expect(dlqFn.Properties.Timeout).toBe(300);
    expect(dlqFn.Properties.MemorySize).toBe(256);
  });

  it('includes DLQ env vars in Lambda environment', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'x402-dlq-sweep-dev',
      Environment: {
        Variables: Match.objectLike({
          DLQ_MAX_RETRIES: '5',
          DLQ_SWEEP_BATCH_SIZE: '25',
          DLQ_BASE_DELAY_MS: '300000',
          DLQ_MAX_DELAY_MS: '14400000',
        }),
      },
    });
  });

  it('creates EventBridge rule with 5-minute schedule', () => {
    const rules = template.findResources('AWS::Events::Rule');
    const sweepRule = Object.values(rules).find((r) => r.Properties.Name === 'x402-dlq-sweep-dev');
    expect(sweepRule).toBeDefined();
    expect(sweepRule.Properties.ScheduleExpression).toBe('rate(5 minutes)');
  });

  it('creates CloudWatch alarm for dlq-sweep Lambda errors', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const sweepAlarm = Object.values(alarms).find(
      (a) => a.Properties.AlarmName === 'x402-dev-dlqsweep-errors',
    );
    expect(sweepAlarm).toBeDefined();
    expect(sweepAlarm.Properties.Threshold).toBe(5);
  });
});

describe('X402Stack — WAF WebACL', () => {
  const template = buildTemplate();

  it('creates a WAF WebACL with REGIONAL scope', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Name: 'x402-waf-dev',
      Scope: 'REGIONAL',
      DefaultAction: { Allow: {} },
    });
  });

  it('includes AWSManagedRulesCommonRuleSet', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: 'AWSManagedRulesCommonRuleSet',
          Priority: 1,
          OverrideAction: { None: {} },
          Statement: {
            ManagedRuleGroupStatement: {
              VendorName: 'AWS',
              Name: 'AWSManagedRulesCommonRuleSet',
            },
          },
        }),
      ]),
    });
  });

  it('includes AWSManagedRulesKnownBadInputsRuleSet', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: 'AWSManagedRulesKnownBadInputsRuleSet',
          Priority: 2,
          Statement: {
            ManagedRuleGroupStatement: {
              VendorName: 'AWS',
              Name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
        }),
      ]),
    });
  });

  it('enables CloudWatch metrics and sampled requests on the WebACL', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      VisibilityConfig: {
        CloudWatchMetricsEnabled: true,
        MetricName: 'x402-waf-dev',
        SampledRequestsEnabled: true,
      },
    });
  });

  it('creates a WebACL association with the API Gateway stage', () => {
    const associations = template.findResources('AWS::WAFv2::WebACLAssociation');
    expect(Object.keys(associations).length).toBe(1);
    const assoc = Object.values(associations)[0];
    expect(assoc.Properties.WebACLArn).toBeDefined();
    expect(assoc.Properties.ResourceArn).toBeDefined();
  });

  it('uses stage name in prod WebACL', () => {
    const prodTemplate = buildTemplate('prod');
    prodTemplate.hasResourceProperties('AWS::WAFv2::WebACL', {
      Name: 'x402-waf-prod',
      VisibilityConfig: Match.objectLike({
        MetricName: 'x402-waf-prod',
      }),
    });
  });
});

describe('X402Stack — API Gateway RequestValidators', () => {
  const template = buildTemplate();

  // body RequestValidator removed with /v1/quote unrouting (was the only consumer).

  it('does not create a params RequestValidator (removed — Lambda handles X-Payment)', () => {
    const validators = template.findResources('AWS::ApiGateway::RequestValidator');
    const paramsValidator = Object.values(validators).find(
      (v) => v.Properties.ValidateRequestParameters === true,
    );
    expect(paramsValidator).toBeUndefined();
  });

  // body validator stage-name test removed with /v1/quote unrouting.

  // QuoteRequest model + /v1/quote validator tests removed with /v1/quote unrouting.

  it('does not attach params validator or required X-Payment header to /v1/resource', () => {
    const methods = template.findResources('AWS::ApiGateway::Method');
    const resourcePost = Object.entries(methods).find(
      ([id, m]) =>
        id.toLowerCase().includes('resource') &&
        m.Properties.HttpMethod === 'POST' &&
        m.Properties.HttpMethod !== 'OPTIONS',
    );
    expect(resourcePost).toBeDefined();
    const [, method] = resourcePost;
    expect(method.Properties.RequestParameters).toBeUndefined();
  });

  it('does not attach validators to non-validated endpoints', () => {
    const methods = template.findResources('AWS::ApiGateway::Method');
    const healthGet = Object.entries(methods).find(
      ([id, m]) =>
        id.toLowerCase().includes('health') &&
        !id.toLowerCase().includes('ready') &&
        m.Properties.HttpMethod === 'GET',
    );
    expect(healthGet).toBeDefined();
    const [, method] = healthGet;
    expect(method.Properties.RequestValidatorId).toBeUndefined();
  });
});

describe('X402Stack — DynamoDB point-in-time recovery', () => {
  const template = buildTemplate();

  it('enables PITR on all 11 DynamoDB tables', () => {
    const tables = template.findResources('AWS::DynamoDB::Table');
    const tableEntries = Object.values(tables);
    expect(tableEntries.length).toBeGreaterThanOrEqual(11);
    for (const table of tableEntries) {
      expect(table.Properties.PointInTimeRecoverySpecification).toEqual({
        PointInTimeRecoveryEnabled: true,
      });
    }
  });
});

describe('X402Stack — CloudWatch Dashboard', () => {
  const template = buildTemplate();

  it('creates a CloudWatch Dashboard named x402-dev', () => {
    const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
    const entries = Object.values(dashboards);
    expect(entries.length).toBe(1);
    expect(entries[0].Properties.DashboardName).toBe('x402-dev');
  });

  it('uses prod stage name in prod dashboard', () => {
    const prodTemplate = buildTemplate('prod');
    const dashboards = prodTemplate.findResources('AWS::CloudWatch::Dashboard');
    const entry = Object.values(dashboards)[0];
    expect(entry.Properties.DashboardName).toBe('x402-prod');
  });

  it('dashboard body contains Lambda Errors widget', () => {
    const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
    const body = Object.values(dashboards)[0].Properties.DashboardBody;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    expect(bodyStr).toContain('Lambda Errors');
  });

  it('dashboard body contains Lambda Invocations widget', () => {
    const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
    const body = Object.values(dashboards)[0].Properties.DashboardBody;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    expect(bodyStr).toContain('Lambda Invocations');
  });

  it('dashboard body contains Lambda Duration P99 widget', () => {
    const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
    const body = Object.values(dashboards)[0].Properties.DashboardBody;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    expect(bodyStr).toContain('Lambda Duration P99');
  });

  it('dashboard body contains API Gateway Latency widget', () => {
    const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
    const body = Object.values(dashboards)[0].Properties.DashboardBody;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    expect(bodyStr).toContain('API Gateway Latency');
  });

  it('dashboard body contains API Gateway Requests widget', () => {
    const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
    const body = Object.values(dashboards)[0].Properties.DashboardBody;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    expect(bodyStr).toContain('API Gateway Requests');
  });

  it('dashboard body contains DDB Throttled Requests widget', () => {
    const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
    const body = Object.values(dashboards)[0].Properties.DashboardBody;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    expect(bodyStr).toContain('DDB Throttled Requests');
  });

  it('dashboard body contains Payment Counts widget', () => {
    const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
    const body = Object.values(dashboards)[0].Properties.DashboardBody;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    expect(bodyStr).toContain('Payment Counts');
  });

  it('dashboard body contains Summary widget', () => {
    const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
    const body = Object.values(dashboards)[0].Properties.DashboardBody;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    expect(bodyStr).toContain('Summary');
  });
});

describe('X402Stack — health canary', () => {
  const template = buildTemplate();

  it('creates a Synthetics canary with stage-suffixed name', () => {
    template.hasResourceProperties('AWS::Synthetics::Canary', {
      Name: 'x402-dev-health',
    });
  });

  it('sets canary schedule to every 15 minutes in non-prod', () => {
    // Prod runs every 5 min; non-prod (dev/staging) uses a 15-min cadence
    // to cut Synthetics costs while keeping the smoke signal alive.
    template.hasResourceProperties('AWS::Synthetics::Canary', {
      Schedule: Match.objectLike({
        Expression: 'rate(15 minutes)',
      }),
    });
  });

  it('passes CANARY_TARGET_URL env var referencing API GW', () => {
    template.hasResourceProperties('AWS::Synthetics::Canary', {
      RunConfig: Match.objectLike({
        EnvironmentVariables: Match.objectLike({
          CANARY_TARGET_URL: Match.anyValue(),
        }),
      }),
    });
  });

  it('creates a CloudWatch alarm for canary failures', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'x402-dev-health-canary-failed',
      ComparisonOperator: 'LessThanThreshold',
      Threshold: 100,
      EvaluationPeriods: 2,
    });
  });

  it('wires canary alarm to the shared SNS alarm topic', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const canaryAlarm = Object.values(alarms).find(
      (a) => a.Properties.AlarmName === 'x402-dev-health-canary-failed',
    );
    expect(canaryAlarm.Properties.AlarmActions).toBeDefined();
    expect(canaryAlarm.Properties.AlarmActions.length).toBe(1);
  });

  it('sets 7-day success and 14-day failure retention', () => {
    template.hasResourceProperties('AWS::Synthetics::Canary', {
      SuccessRetentionPeriod: 7,
      FailureRetentionPeriod: 14,
    });
  });

  it('uses correct canary name in prod stage', () => {
    const prodTemplate = buildTemplate('prod');
    prodTemplate.hasResourceProperties('AWS::Synthetics::Canary', {
      Name: 'x402-prod-health',
    });
  });
});

describe('X402Stack — UsagePlan + ApiKey', () => {
  const template = buildTemplate();

  it('creates a UsagePlan resource', () => {
    const plans = template.findResources('AWS::ApiGateway::UsagePlan');
    expect(Object.keys(plans).length).toBeGreaterThanOrEqual(1);
  });

  it('names the usage plan with the stage', () => {
    template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
      UsagePlanName: 'x402-usage-plan-dev',
    });
  });

  it('sets throttle rate 25 and burst 50 on usage plan', () => {
    template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
      Throttle: { BurstLimit: 50, RateLimit: 25 },
    });
  });

  it('sets monthly quota of 100000 on usage plan', () => {
    template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
      Quota: Match.objectLike({ Limit: 100000, Period: 'MONTH' }),
    });
  });

  it('associates usage plan with the API stage', () => {
    template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
      ApiStages: Match.arrayWith([
        Match.objectLike({
          ApiId: Match.anyValue(),
          Stage: Match.anyValue(),
        }),
      ]),
    });
  });

  it('creates an ApiKey resource', () => {
    const keys = template.findResources('AWS::ApiGateway::ApiKey');
    expect(Object.keys(keys).length).toBeGreaterThanOrEqual(1);
  });

  it('names the API key with the stage and enables it', () => {
    template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
      Name: 'x402-default-key-dev',
      Enabled: true,
    });
  });

  it('links the API key to the usage plan', () => {
    const links = template.findResources('AWS::ApiGateway::UsagePlanKey');
    expect(Object.keys(links).length).toBeGreaterThanOrEqual(1);
  });

  it('uses prod stage name in prod template', () => {
    const prodTemplate = buildTemplate('prod');
    prodTemplate.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
      UsagePlanName: 'x402-usage-plan-prod',
    });
    prodTemplate.hasResourceProperties('AWS::ApiGateway::ApiKey', {
      Name: 'x402-default-key-prod',
    });
  });
});

describe('X402Stack — API Gateway access logging', () => {
  const template = buildTemplate();

  it('configures access log destination on the deployment stage', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      AccessLogSetting: Match.objectLike({
        DestinationArn: Match.anyValue(),
      }),
    });
  });

  it('uses JSON format for access logs', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      AccessLogSetting: Match.objectLike({
        Format: Match.stringLikeRegexp('"requestId"'),
      }),
    });
  });

  it('includes standard fields in access log format', () => {
    const stages = template.findResources('AWS::ApiGateway::Stage');
    const stage = Object.values(stages).find((s) => s.Properties?.AccessLogSetting);
    const format = stage.Properties.AccessLogSetting.Format;
    const parsed = JSON.parse(format);
    expect(parsed).toHaveProperty('requestId');
    expect(parsed).toHaveProperty('ip');
    expect(parsed).toHaveProperty('httpMethod');
    expect(parsed).toHaveProperty('resourcePath');
    expect(parsed).toHaveProperty('status');
    expect(parsed).toHaveProperty('protocol');
    expect(parsed).toHaveProperty('responseLength');
    expect(parsed).toHaveProperty('requestTime');
  });

  it('creates access log group with 30-day retention', () => {
    const logGroups = template.findResources('AWS::Logs::LogGroup');
    const allRetentions = Object.values(logGroups).map((lg) => lg.Properties.RetentionInDays);
    expect(allRetentions.every((r) => r === 30)).toBe(true);
  });

  it('access log group uses DESTROY in dev and RETAIN in prod', () => {
    const devLogGroups = template.findResources('AWS::Logs::LogGroup');
    for (const lg of Object.values(devLogGroups)) {
      expect(lg.DeletionPolicy).toBe('Delete');
    }
    const prodTemplate = buildTemplate('prod');
    const prodLogGroups = prodTemplate.findResources('AWS::Logs::LogGroup');
    for (const lg of Object.values(prodLogGroups)) {
      expect(lg.DeletionPolicy).toBe('Retain');
    }
  });

  it('access log format is valid JSON', () => {
    const stages = template.findResources('AWS::ApiGateway::Stage');
    const stage = Object.values(stages).find((s) => s.Properties?.AccessLogSetting);
    expect(() => JSON.parse(stage.Properties.AccessLogSetting.Format)).not.toThrow();
  });
});

describe('X402Stack — tags', () => {
  const template = buildTemplate();
  const prodTemplate = buildTemplate('prod');

  function collectTags(tpl) {
    const lambdas = tpl.findResources('AWS::Lambda::Function');
    const first = Object.values(lambdas)[0];
    return first?.Properties?.Tags ?? [];
  }

  it('applies Environment tag matching the stage', () => {
    const tags = collectTags(template);
    const envTag = tags.find((t) => t.Key === 'Environment');
    expect(envTag).toBeDefined();
    expect(envTag.Value).toBe('dev');
  });

  it('Environment tag is "prod" for prod stage', () => {
    const tags = collectTags(prodTemplate);
    const envTag = tags.find((t) => t.Key === 'Environment');
    expect(envTag).toBeDefined();
    expect(envTag.Value).toBe('prod');
  });

  it('applies Service tag with value "x402"', () => {
    const tags = collectTags(template);
    const svcTag = tags.find((t) => t.Key === 'Service');
    expect(svcTag).toBeDefined();
    expect(svcTag.Value).toBe('x402');
  });

  it('applies ManagedBy tag with value "cdk"', () => {
    const tags = collectTags(template);
    const mgdTag = tags.find((t) => t.Key === 'ManagedBy');
    expect(mgdTag).toBeDefined();
    expect(mgdTag.Value).toBe('cdk');
  });

  it('tags propagate to DynamoDB tables', () => {
    const tables = template.findResources('AWS::DynamoDB::Table');
    const first = Object.values(tables)[0];
    const tags = first?.Properties?.Tags ?? [];
    const keys = tags.map((t) => t.Key);
    expect(keys).toContain('Environment');
    expect(keys).toContain('Service');
    expect(keys).toContain('ManagedBy');
  });

  it('tags propagate to API Gateway RestApi', () => {
    const apis = template.findResources('AWS::ApiGateway::RestApi');
    const first = Object.values(apis)[0];
    const tags = first?.Properties?.Tags ?? [];
    const keys = tags.map((t) => t.Key);
    expect(keys).toContain('Environment');
    expect(keys).toContain('Service');
    expect(keys).toContain('ManagedBy');
  });
});
