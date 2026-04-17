import { CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  RestApi,
  LambdaIntegration,
  ApiKeySourceType,
  Cors,
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

    // bodyValidator + quoteModel removed with /v1/quote unrouting.
    // Re-add when a real exchange adapter ships.

    const apiInt = new LambdaIntegration(lambdas.apiFn);
    const v1 = this.api.root.addResource('v1');

    const health = v1.addResource('health');
    health.addMethod('GET', apiInt);
    health.addResource('ready').addMethod('GET', apiInt);

    // Tenant auth (x-api-key=x402_...) is verified by the Lambda auth middleware,
    // not by API Gateway's own API-key system — those two systems both read the
    // x-api-key header and would collide. `apiKeyRequired: true` is intentionally
    // NOT set on tenant-scoped routes.
    //
    // /v1/quote intentionally NOT wired — the 5 exchange adapters are stubs
    // that return fake math. Hidden until a real adapter ships.
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
    // Login / logout / HTML pages are served by the dashboard Lambda
    // (same pino logger, same secrets-manager config). JSON endpoints
    // (/admin/tenants, /admin/earnings, /admin/earnings.json) are served
    // by the api Lambda so they share validators / rate limit wiring.
    admin.addMethod('GET', dashboardInt);
    admin.addResource('login').addMethod('POST', dashboardInt);
    admin.addResource('logout').addMethod('GET', dashboardInt);
    const adminChangePw = admin.addResource('change-password');
    adminChangePw.addMethod('GET', dashboardInt);
    adminChangePw.addMethod('POST', dashboardInt);
    const adminTenants = admin.addResource('tenants');
    adminTenants.addMethod('GET', apiInt);
    adminTenants.addResource('ui').addMethod('GET', dashboardInt);
    admin.addResource('metrics').addResource('ui').addMethod('GET', dashboardInt);
    admin.addResource('earnings').addMethod('GET', apiInt);
    admin.addResource('earnings.json').addMethod('GET', apiInt);

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
