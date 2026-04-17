import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { ApiGateway } from '../../infra/stacks/constructs/api-gateway.js';

function buildTemplate(stage = 'dev', envOverrides = {}) {
  const app = new App();
  const stack = new Stack(app, `TestStack-${stage}-${Date.now()}`);

  const fnProps = {
    runtime: Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => ({})'),
  };

  const lambdas = {
    apiFn: new Function(stack, 'ApiFn', { ...fnProps, functionName: `api-${stage}` }),
    stripeWebhookFn: new Function(stack, 'StripeWebhookFn', {
      ...fnProps,
      functionName: `stripe-webhook-${stage}`,
    }),
    webhookFn: new Function(stack, 'WebhookFn', {
      ...fnProps,
      functionName: `webhook-${stage}`,
    }),
    dashboardFn: new Function(stack, 'DashboardFn', {
      ...fnProps,
      functionName: `dashboard-${stage}`,
    }),
    fetchFn: new Function(stack, 'FetchFn', {
      ...fnProps,
      functionName: `fetch-${stage}`,
    }),
  };

  const saved = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }

  const gw = new ApiGateway(stack, 'ApiGw', { stage, lambdas });

  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  return { template: Template.fromStack(stack), gw };
}

function collectMethods(template) {
  const methods = template.findResources('AWS::ApiGateway::Method');
  return Object.entries(methods)
    .filter(([, m]) => m.Properties.HttpMethod !== 'OPTIONS')
    .map(([id, m]) => ({
      id,
      httpMethod: m.Properties.HttpMethod,
      apiKeyRequired: m.Properties.ApiKeyRequired || false,
      validatorId: m.Properties.RequestValidatorId,
      requestModels: m.Properties.RequestModels,
      requestParams: m.Properties.RequestParameters,
    }));
}

describe('ApiGateway construct — route count', () => {
  const { template } = buildTemplate();
  const methods = collectMethods(template);

  it('creates exactly 24 non-OPTIONS API methods', () => {
    expect(methods.length).toBe(24);
  });

  it('creates 2 GET health routes (health + ready)', () => {
    const healthMethods = methods.filter(
      (m) => m.httpMethod === 'GET' && m.id.toLowerCase().includes('health'),
    );
    expect(healthMethods.length).toBe(2);
  });

  it('creates POST /v1/quote', () => {
    const match = methods.find(
      (m) => m.id.toLowerCase().includes('quote') && m.httpMethod === 'POST',
    );
    expect(match).toBeDefined();
  });

  it('creates POST /v1/resource', () => {
    const match = methods.find(
      (m) =>
        m.id.toLowerCase().includes('resource') &&
        !m.id.toLowerCase().includes('premium') &&
        m.httpMethod === 'POST',
    );
    expect(match).toBeDefined();
  });

  it('creates POST /v1/resource/premium', () => {
    const match = methods.find(
      (m) => m.id.toLowerCase().includes('premium') && m.httpMethod === 'POST',
    );
    expect(match).toBeDefined();
  });

  it('creates GET /v1/payments', () => {
    const match = methods.find(
      (m) => m.id.toLowerCase().includes('payments') && m.httpMethod === 'GET',
    );
    expect(match).toBeDefined();
  });

  it('creates POST /v1/fetch', () => {
    const match = methods.find(
      (m) => m.id.toLowerCase().includes('fetch') && m.httpMethod === 'POST',
    );
    expect(match).toBeDefined();
  });

  it('creates POST webhooks/stripe', () => {
    const match = methods.find(
      (m) => m.id.toLowerCase().includes('stripe') && m.httpMethod === 'POST',
    );
    expect(match).toBeDefined();
  });

  it('creates POST webhooks/{provider}', () => {
    const match = methods.find(
      (m) => m.id.toLowerCase().includes('provider') && m.httpMethod === 'POST',
    );
    expect(match).toBeDefined();
  });

  it('creates 4 dashboard routes (GET, POST signup, POST rotate-key, GET/PUT/DELETE routes)', () => {
    const dashMethods = methods.filter((m) => m.id.toLowerCase().includes('dashboard'));
    expect(dashMethods.length).toBe(6);
  });

  it('creates GET /admin/tenants', () => {
    const match = methods.find(
      (m) => m.id.toLowerCase().includes('admin') && m.httpMethod === 'GET',
    );
    expect(match).toBeDefined();
  });
});

describe('ApiGateway construct — API key requirements', () => {
  const { template } = buildTemplate();
  const methods = collectMethods(template);

  // Tenant x-api-key is verified by the Lambda auth middleware, not by
  // APIGW's own usage-plan key system — both read x-api-key and would collide.
  // So none of the tenant-scoped routes should carry apiKeyRequired: true.
  it('does NOT require APIGW key on POST /v1/quote (tenant key handled by Lambda)', () => {
    const m = methods.find((m) => m.id.toLowerCase().includes('quote') && m.httpMethod === 'POST');
    expect(m.apiKeyRequired).toBe(false);
  });

  it('does NOT require APIGW key on POST /v1/resource (x402 flow starts with no auth header other than tenant key)', () => {
    const m = methods.find(
      (m) => m.id.toLowerCase().includes('resource') && m.httpMethod === 'POST',
    );
    expect(m.apiKeyRequired).toBe(false);
  });

  it('does NOT require APIGW key on GET /v1/payments (tenant key handled by Lambda)', () => {
    const m = methods.find(
      (m) => m.id.toLowerCase().includes('payments') && m.httpMethod === 'GET',
    );
    expect(m.apiKeyRequired).toBe(false);
  });

  it('does NOT require APIGW key on GET /admin/tenants (admin auth handled by Lambda)', () => {
    const m = methods.find((m) => m.id.toLowerCase().includes('admin') && m.httpMethod === 'GET');
    expect(m.apiKeyRequired).toBe(false);
  });

  it('does NOT require APIGW key on POST /v1/fetch (tenant key handled by Lambda)', () => {
    const m = methods.find((m) => m.id.toLowerCase().includes('fetch') && m.httpMethod === 'POST');
    expect(m.apiKeyRequired).toBe(false);
  });

  it('does NOT require API key on health endpoints', () => {
    const healthMethods = methods.filter(
      (m) => m.httpMethod === 'GET' && m.id.toLowerCase().includes('health'),
    );
    for (const m of healthMethods) {
      expect(m.apiKeyRequired).toBe(false);
    }
  });

  it('does NOT require API key on webhook endpoints', () => {
    const webhookMethods = methods.filter(
      (m) => m.id.toLowerCase().includes('webhook') || m.id.toLowerCase().includes('provider'),
    );
    for (const m of webhookMethods) {
      expect(m.apiKeyRequired).toBe(false);
    }
  });
});

describe('ApiGateway construct — CORS config', () => {
  let savedOrigins;

  beforeEach(() => {
    savedOrigins = process.env.ALLOWED_ORIGINS;
  });

  afterEach(() => {
    if (savedOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = savedOrigins;
  });

  it('defaults to wildcard when ALLOWED_ORIGINS unset', () => {
    delete process.env.ALLOWED_ORIGINS;
    const { template } = buildTemplate('cors-def');
    const methods = template.findResources('AWS::ApiGateway::Method', {
      Properties: { HttpMethod: 'OPTIONS' },
    });
    const resp = Object.values(methods)[0]?.Properties?.Integration?.IntegrationResponses?.[0];
    expect(resp?.ResponseParameters?.['method.response.header.Access-Control-Allow-Origin']).toBe(
      "'*'",
    );
  });

  it('uses custom origins from ALLOWED_ORIGINS env var', () => {
    const { template } = buildTemplate('cors-cust', {
      ALLOWED_ORIGINS: 'https://a.io,https://b.io',
    });
    const methods = template.findResources('AWS::ApiGateway::Method', {
      Properties: { HttpMethod: 'OPTIONS' },
    });
    const resp = Object.values(methods)[0]?.Properties?.Integration?.IntegrationResponses?.[0];
    expect(resp?.ResponseParameters?.['method.response.header.Access-Control-Allow-Origin']).toBe(
      "'https://a.io'",
    );
  });

  it('includes x402 headers in CORS allowHeaders', () => {
    const { template } = buildTemplate('cors-hdr');
    const methods = template.findResources('AWS::ApiGateway::Method', {
      Properties: { HttpMethod: 'OPTIONS' },
    });
    const resp = Object.values(methods)[0]?.Properties?.Integration?.IntegrationResponses?.[0];
    const headers =
      resp?.ResponseParameters?.['method.response.header.Access-Control-Allow-Headers'];
    expect(headers).toContain('X-Payment');
    expect(headers).toContain('Idempotency-Key');
    expect(headers).toContain('X-Correlation-Id');
    expect(headers).toContain('X-Api-Key');
  });
});

describe('ApiGateway construct — request validators', () => {
  const { template } = buildTemplate();

  it('creates body validator with correct settings', () => {
    template.hasResourceProperties('AWS::ApiGateway::RequestValidator', {
      Name: 'x402-body-validator-dev',
      ValidateRequestBody: true,
      ValidateRequestParameters: false,
    });
  });

  it('uses stage in validator name for prod', () => {
    const { template: prod } = buildTemplate('prod');
    prod.hasResourceProperties('AWS::ApiGateway::RequestValidator', {
      Name: 'x402-body-validator-prod',
    });
  });

  it('attaches body validator + QuoteRequest model to /v1/quote', () => {
    const methods = template.findResources('AWS::ApiGateway::Method');
    const quotePost = Object.values(methods).find(
      (m) =>
        m.Properties.HttpMethod === 'POST' && JSON.stringify(m.Properties).includes('QuoteRequest'),
    );
    expect(quotePost).toBeDefined();
    expect(quotePost.Properties.RequestValidatorId).toBeDefined();
    expect(quotePost.Properties.RequestModels['application/json']).toBeDefined();
  });

  it('does NOT require X-Payment header on /v1/resource — 402 flow starts without it', () => {
    const methods = template.findResources('AWS::ApiGateway::Method');
    const match = Object.entries(methods).find(
      ([id, m]) => id.toLowerCase().includes('resource') && m.Properties.HttpMethod === 'POST',
    );
    expect(match).toBeDefined();
    const [, method] = match;
    const params = method.Properties.RequestParameters;
    expect(params?.['method.request.header.X-Payment']).toBeUndefined();
  });

  it('QuoteRequest model has correct JSON schema', () => {
    const models = template.findResources('AWS::ApiGateway::Model');
    const quoteModel = Object.values(models).find((m) => m.Properties.Name === 'QuoteRequest');
    expect(quoteModel).toBeDefined();
    const schema = quoteModel.Properties.Schema;
    expect(schema.required).toEqual(['fiatCurrency', 'fiatAmount', 'cryptoAsset']);
    expect(schema.properties.fiatCurrency.enum).toEqual(['USD', 'EUR', 'GBP']);
    // Draft-4 (API Gateway's flavor): exclusiveMinimum is a boolean modifier
    // on minimum, not a standalone numeric keyword.
    expect(schema.properties.fiatAmount.minimum).toBe(0);
    expect(schema.properties.fiatAmount.exclusiveMinimum).toBe(true);
    expect(schema.properties.fiatAmount.maximum).toBe(50000);
    expect(schema.properties.cryptoAsset.enum).toEqual(['USDC', 'XRP', 'ETH']);
    expect(schema.properties.exchange.enum).toEqual([
      'moonpay',
      'coinbase',
      'kraken',
      'binance',
      'uphold',
    ]);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('ApiGateway construct — method throttling', () => {
  const { template } = buildTemplate();

  it('sets stage-level defaults of 25 rps / 50 burst', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          HttpMethod: '*',
          ResourcePath: '/*',
          ThrottlingRateLimit: 25,
          ThrottlingBurstLimit: 50,
        }),
      ]),
    });
  });

  it('throttles POST /v1/quote to 10 rps / 20 burst', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          HttpMethod: 'POST',
          ResourcePath: '/~1v1~1quote',
          ThrottlingRateLimit: 10,
          ThrottlingBurstLimit: 20,
        }),
      ]),
    });
  });

  it('throttles POST /v1/resource to 5 rps / 10 burst', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          HttpMethod: 'POST',
          ResourcePath: '/~1v1~1resource',
          ThrottlingRateLimit: 5,
          ThrottlingBurstLimit: 10,
        }),
      ]),
    });
  });

  it('throttles POST /v1/resource/premium to 5 rps / 10 burst', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          HttpMethod: 'POST',
          ResourcePath: '/~1v1~1resource~1premium',
          ThrottlingRateLimit: 5,
          ThrottlingBurstLimit: 10,
        }),
      ]),
    });
  });

  it('throttles POST /v1/fetch to 5 rps / 10 burst', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          HttpMethod: 'POST',
          ResourcePath: '/~1v1~1fetch',
          ThrottlingRateLimit: 5,
          ThrottlingBurstLimit: 10,
        }),
      ]),
    });
  });

  it('enables X-Ray tracing on the stage', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      TracingEnabled: true,
    });
  });
});

describe('ApiGateway construct — UsagePlan + ApiKey', () => {
  const { template } = buildTemplate();

  it('creates a UsagePlan with stage-suffixed name', () => {
    template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
      UsagePlanName: 'x402-usage-plan-dev',
    });
  });

  it('sets throttle 25 rps / 50 burst on usage plan', () => {
    template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
      Throttle: { RateLimit: 25, BurstLimit: 50 },
    });
  });

  it('sets 100k monthly quota', () => {
    template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
      Quota: Match.objectLike({ Limit: 100000, Period: 'MONTH' }),
    });
  });

  it('associates usage plan with the API stage', () => {
    template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
      ApiStages: Match.arrayWith([
        Match.objectLike({ ApiId: Match.anyValue(), Stage: Match.anyValue() }),
      ]),
    });
  });

  it('creates an enabled ApiKey with stage-suffixed name', () => {
    template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
      Name: 'x402-default-key-dev',
      Enabled: true,
    });
  });

  it('links ApiKey to UsagePlan', () => {
    const links = template.findResources('AWS::ApiGateway::UsagePlanKey');
    expect(Object.keys(links).length).toBeGreaterThanOrEqual(1);
  });

  it('uses prod stage name for prod', () => {
    const { template: prod } = buildTemplate('prod');
    prod.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
      UsagePlanName: 'x402-usage-plan-prod',
    });
    prod.hasResourceProperties('AWS::ApiGateway::ApiKey', {
      Name: 'x402-default-key-prod',
    });
  });
});

describe('ApiGateway construct — access logging', () => {
  const { template } = buildTemplate();

  it('creates an access log group with 30-day retention', () => {
    const logGroups = template.findResources('AWS::Logs::LogGroup');
    const entries = Object.values(logGroups);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const accessLog = entries.find((lg) => lg.Properties.RetentionInDays === 30);
    expect(accessLog).toBeDefined();
  });

  it('access log group uses DESTROY in dev', () => {
    const logGroups = template.findResources('AWS::Logs::LogGroup');
    for (const lg of Object.values(logGroups)) {
      expect(lg.DeletionPolicy).toBe('Delete');
    }
  });

  it('access log group uses RETAIN in prod', () => {
    const { template: prod } = buildTemplate('prod');
    const logGroups = prod.findResources('AWS::Logs::LogGroup');
    for (const lg of Object.values(logGroups)) {
      expect(lg.DeletionPolicy).toBe('Retain');
    }
  });

  it('configures JSON access log format on the stage', () => {
    const stages = template.findResources('AWS::ApiGateway::Stage');
    const stage = Object.values(stages).find((s) => s.Properties?.AccessLogSetting);
    expect(stage).toBeDefined();
    const format = stage.Properties.AccessLogSetting.Format;
    const parsed = JSON.parse(format);
    expect(parsed).toHaveProperty('requestId');
    expect(parsed).toHaveProperty('ip');
    expect(parsed).toHaveProperty('httpMethod');
    expect(parsed).toHaveProperty('status');
    expect(parsed).toHaveProperty('resourcePath');
  });
});

describe('ApiGateway construct — RestApi naming', () => {
  it('names the API with the stage suffix', () => {
    const { template } = buildTemplate('staging');
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'x402-api-staging',
    });
  });

  it('sets apiKeySourceType to HEADER', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      ApiKeySourceType: 'HEADER',
    });
  });
});

describe('ApiGateway construct — exposes api and apiKey', () => {
  it('exposes api property as RestApi', () => {
    const { gw } = buildTemplate();
    expect(gw.api).toBeDefined();
    expect(gw.api.restApiId).toBeDefined();
  });

  it('exposes apiKey property', () => {
    const { gw } = buildTemplate();
    expect(gw.apiKey).toBeDefined();
  });

  it('exposes accessLogGroup property', () => {
    const { gw } = buildTemplate();
    expect(gw.accessLogGroup).toBeDefined();
  });
});
