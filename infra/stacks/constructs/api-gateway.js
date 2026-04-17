import { CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  RestApi,
  LambdaIntegration,
  ApiKeySourceType,
  Cors,
  RequestValidator,
  Model,
  JsonSchemaVersion,
  JsonSchemaType,
  UsagePlan,
  ApiKey,
  Period,
  AccessLogFormat,
  LogGroupLogDestination,
  EndpointType,
  DomainName,
  BasePathMapping,
  SecurityPolicy,
} from 'aws-cdk-lib/aws-apigateway';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class ApiGateway extends Construct {
  constructor(scope, id, { stage, lambdas, customDomain }) {
    super(scope, id);

    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : Cors.ALL_ORIGINS;

    const isProd = stage === 'prod';

    this.accessLogGroup = new LogGroup(this, 'AccessLogs', {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    this.api = new RestApi(this, 'Api', {
      restApiName: `x402-api-${stage}`,
      apiKeySourceType: ApiKeySourceType.HEADER,
      endpointConfiguration: { types: [EndpointType.REGIONAL] },
      deployOptions: {
        stageName: stage,
        throttlingBurstLimit: 50,
        throttlingRateLimit: 25,
        tracingEnabled: true,
        accessLogDestination: new LogGroupLogDestination(this.accessLogGroup),
        accessLogFormat: AccessLogFormat.custom(
          JSON.stringify({
            requestId: '$context.requestId',
            ip: '$context.identity.sourceIp',
            caller: '$context.identity.caller',
            user: '$context.identity.user',
            requestTime: '$context.requestTime',
            httpMethod: '$context.httpMethod',
            resourcePath: '$context.resourcePath',
            status: '$context.status',
            protocol: '$context.protocol',
            responseLength: '$context.responseLength',
          }),
        ),
        methodOptions: {
          '/v1/quote/POST': { throttlingRateLimit: 10, throttlingBurstLimit: 20 },
          '/v1/resource/POST': { throttlingRateLimit: 5, throttlingBurstLimit: 10 },
          '/v1/resource/premium/POST': { throttlingRateLimit: 5, throttlingBurstLimit: 10 },
          '/v1/fetch/POST': { throttlingRateLimit: 5, throttlingBurstLimit: 10 },
        },
      },
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Api-Key',
          'X-Payment',
          'Idempotency-Key',
          'X-Correlation-Id',
        ],
        maxAge: Duration.hours(1),
      },
    });

    const bodyValidator = new RequestValidator(this, 'BodyValidator', {
      restApi: this.api,
      requestValidatorName: `x402-body-validator-${stage}`,
      validateRequestBody: true,
      validateRequestParameters: false,
    });

    const quoteModel = new Model(this, 'QuoteRequestModel', {
      restApi: this.api,
      contentType: 'application/json',
      modelName: 'QuoteRequest',
      schema: {
        schema: JsonSchemaVersion.DRAFT4,
        type: JsonSchemaType.OBJECT,
        required: ['fiatCurrency', 'fiatAmount', 'cryptoAsset'],
        properties: {
          fiatCurrency: { type: JsonSchemaType.STRING, enum: ['USD', 'EUR', 'GBP'] },
          fiatAmount: {
            type: JsonSchemaType.NUMBER,
            minimum: 0,
            exclusiveMinimum: true,
            maximum: 50000,
          },
          cryptoAsset: { type: JsonSchemaType.STRING, enum: ['USDC', 'XRP', 'ETH'] },
          exchange: {
            type: JsonSchemaType.STRING,
            enum: ['moonpay', 'coinbase', 'kraken', 'binance', 'uphold'],
          },
        },
        additionalProperties: false,
      },
    });

    const apiInt = new LambdaIntegration(lambdas.apiFn);
    const v1 = this.api.root.addResource('v1');

    const health = v1.addResource('health');
    health.addMethod('GET', apiInt);
    health.addResource('ready').addMethod('GET', apiInt);

    // Tenant auth (x-api-key=x402_...) is verified by the Lambda auth middleware,
    // not by API Gateway's own API-key system — those two systems both read the
    // x-api-key header and would collide. `apiKeyRequired: true` is intentionally
    // NOT set on tenant-scoped routes.
    v1.addResource('quote').addMethod('POST', apiInt, {
      requestValidator: bodyValidator,
      requestModels: { 'application/json': quoteModel },
    });
    // /v1/resource MUST allow requests with no X-Payment header — that is the
    // trigger for the x402 challenge (HTTP 402) response. Do not mark X-Payment
    // as a required request parameter here.
    const resource = v1.addResource('resource');
    resource.addMethod('POST', apiInt);
    resource.addResource('premium').addMethod('POST', apiInt);
    v1.addResource('payments').addMethod('GET', apiInt);
    v1.addResource('fetch').addMethod('POST', new LambdaIntegration(lambdas.fetchFn));

    // Public, unauth'd live demo endpoint used by the bitbooth.html landing
    // page Race Mode. Fires a real on-chain Base Sepolia transfer from the
    // agent wallet to a freshly-generated ephemeral receiver. Per-IP rate
    // limit (1/min) inside the Lambda prevents drainage of the demo wallet.
    v1.addResource('demo').addResource('relay').addMethod('POST', apiInt);

    const webhooks = v1.addResource('webhooks');
    webhooks
      .addResource('stripe')
      .addMethod('POST', new LambdaIntegration(lambdas.stripeWebhookFn));
    webhooks.addResource('{provider}').addMethod('POST', new LambdaIntegration(lambdas.webhookFn));

    const dashboardInt = new LambdaIntegration(lambdas.dashboardFn);

    // Landing + public docs + raw openapi.yaml all served from the dashboard
    // Lambda (same handler, same cold start). Keeps infra count at zero new
    // Lambdas while giving the product a public front door.
    this.api.root.addMethod('GET', dashboardInt);
    this.api.root.addResource('docs').addMethod('GET', dashboardInt);
    this.api.root.addResource('openapi.yaml').addMethod('GET', dashboardInt);

    // Frictionless demo signup — IP rate-limited in the Lambda, not at API GW,
    // because we want a friendly 429 JSON body instead of API GW's default.
    this.api.root.addResource('demo').addResource('signup').addMethod('POST', dashboardInt);

    const dashboard = this.api.root.addResource('dashboard');
    dashboard.addMethod('GET', dashboardInt);
    dashboard.addResource('signup').addMethod('POST', dashboardInt);
    dashboard.addResource('rotate-key').addMethod('POST', dashboardInt);
    const dashboardRoutes = dashboard.addResource('routes');
    dashboardRoutes.addMethod('GET', dashboardInt);
    dashboardRoutes.addMethod('PUT', dashboardInt);
    dashboardRoutes.addMethod('DELETE', dashboardInt);

    const portal = this.api.root.addResource('portal');
    portal.addMethod('GET', dashboardInt);
    portal.addResource('login').addMethod('POST', dashboardInt);
    portal.addResource('logout').addMethod('GET', dashboardInt);

    const admin = this.api.root.addResource('admin');
    // Admin auth is enforced by the Lambda admin middleware (hashed admin key),
    // not by API Gateway — same reason as tenant routes above.
    admin.addResource('tenants').addMethod('GET', apiInt);

    const plan = new UsagePlan(this, 'UsagePlan', {
      name: `x402-usage-plan-${stage}`,
      throttle: { rateLimit: 25, burstLimit: 50 },
      quota: { limit: 100000, period: Period.MONTH },
      apiStages: [{ api: this.api, stage: this.api.deploymentStage }],
    });

    this.apiKey = new ApiKey(this, 'DefaultApiKey', {
      apiKeyName: `x402-default-key-${stage}`,
      enabled: true,
    });

    plan.addApiKey(this.apiKey);

    // Custom domain wiring — only provisioned when the stack is given an ACM
    // cert ARN + domain name via env vars (X402_CUSTOM_DOMAIN_NAME /
    // X402_CUSTOM_DOMAIN_CERT_ARN). Staging points at app.heinrichstech.com;
    // prod will get its own domain later with its own cert.
    if (customDomain) {
      this.customDomain = new DomainName(this, 'CustomDomain', {
        domainName: customDomain.domainName,
        certificate: customDomain.certificate,
        endpointType: EndpointType.REGIONAL,
        securityPolicy: SecurityPolicy.TLS_1_2,
      });

      new BasePathMapping(this, 'CustomDomainMapping', {
        domainName: this.customDomain,
        restApi: this.api,
        stage: this.api.deploymentStage,
      });

      new CfnOutput(this, 'CustomDomainTarget', {
        value: this.customDomain.domainNameAliasDomainName,
        description: `CNAME target for ${customDomain.domainName} — paste into Cloudflare`,
      });

      new CfnOutput(this, 'CustomDomainHostedZoneId', {
        value: this.customDomain.domainNameAliasHostedZoneId,
        description: 'API GW regional hosted zone ID (Route 53 ALIAS only)',
      });
    }
  }
}
