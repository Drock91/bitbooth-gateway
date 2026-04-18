import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Function as LambdaFn, Runtime, Code, Tracing } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

export class Lambdas extends Construct {
  constructor(scope, id, { stage, tables, secrets, commonEnv }) {
    super(scope, id);

    const isProd = stage === 'prod';
    const retain = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const mkLogGroup = (name) =>
      new LogGroup(this, `${name}Logs`, {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: retain,
      });

    this.webhookDlqQueue = new Queue(this, 'WebhookDlqQueue', {
      queueName: `x402-webhook-dlq-${stage}`,
      retentionPeriod: Duration.days(14),
    });

    this.stripeWebhookDlqQueue = new Queue(this, 'StripeWebhookDlqQueue', {
      queueName: `x402-stripe-webhook-dlq-${stage}`,
      retentionPeriod: Duration.days(14),
    });

    this.apiFn = new LambdaFn(this, 'ApiFn', {
      functionName: `x402-api-${stage}`,
      runtime: Runtime.NODEJS_20_X,
      handler: 'api.handler',
      code: Code.fromAsset('dist'),
      timeout: Duration.seconds(10),
      memorySize: 512,
      tracing: Tracing.ACTIVE,
      ...(isProd ? { reservedConcurrentExecutions: 100 } : {}),
      environment: commonEnv,
      logGroup: mkLogGroup('ApiFn'),
    });

    this.webhookFn = new LambdaFn(this, 'WebhookFn', {
      functionName: `x402-webhook-${stage}`,
      runtime: Runtime.NODEJS_20_X,
      handler: 'webhook.handler',
      code: Code.fromAsset('dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      ...(isProd ? { reservedConcurrentExecutions: 10 } : {}),
      deadLetterQueue: this.webhookDlqQueue,
      environment: commonEnv,
      logGroup: mkLogGroup('WebhookFn'),
    });

    this.stripeWebhookFn = new LambdaFn(this, 'StripeWebhookFn', {
      functionName: `x402-stripe-webhook-${stage}`,
      runtime: Runtime.NODEJS_20_X,
      handler: 'stripe-webhook.default',
      code: Code.fromAsset('dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      ...(isProd ? { reservedConcurrentExecutions: 10 } : {}),
      deadLetterQueue: this.stripeWebhookDlqQueue,
      environment: commonEnv,
      logGroup: mkLogGroup('StripeWebhookFn'),
    });

    this.dashboardFn = new LambdaFn(this, 'DashboardFn', {
      functionName: `x402-dashboard-${stage}`,
      runtime: Runtime.NODEJS_20_X,
      handler: 'dashboard.handler',
      code: Code.fromAsset('dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      ...(isProd ? { reservedConcurrentExecutions: 10 } : {}),
      environment: commonEnv,
      logGroup: mkLogGroup('DashboardFn'),
    });

    this.dlqSweepFn = new LambdaFn(this, 'DlqSweepFn', {
      functionName: `x402-dlq-sweep-${stage}`,
      runtime: Runtime.NODEJS_20_X,
      handler: 'dlq-sweep.handler',
      code: Code.fromAsset('dist'),
      timeout: Duration.minutes(5),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      ...(isProd ? { reservedConcurrentExecutions: 1 } : {}),
      environment: commonEnv,
      logGroup: mkLogGroup('DlqSweepFn'),
    });

    this.fetchFn = new LambdaFn(this, 'FetchFn', {
      functionName: `x402-fetch-${stage}`,
      runtime: Runtime.NODEJS_20_X,
      handler: 'fetch.handler',
      code: Code.fromAsset('dist'),
      timeout: Duration.seconds(30),
      memorySize: 2048,
      tracing: Tracing.ACTIVE,
      ...(isProd ? { reservedConcurrentExecutions: 20 } : {}),
      environment: commonEnv,
      logGroup: mkLogGroup('FetchFn'),
    });

    // --- IAM grants ---
    tables.webhookDlq.grantReadWriteData(this.dlqSweepFn);
    secrets.moonpay.grantRead(this.dlqSweepFn);
    secrets.coinbase.grantRead(this.dlqSweepFn);
    secrets.kraken.grantRead(this.dlqSweepFn);
    secrets.binance.grantRead(this.dlqSweepFn);
    secrets.uphold.grantRead(this.dlqSweepFn);

    tables.payments.grantReadData(this.dashboardFn);
    tables.tenants.grantReadWriteData(this.dashboardFn);
    tables.routes.grantReadWriteData(this.dashboardFn);
    tables.usage.grantReadData(this.dashboardFn);
    tables.rateLimit.grantReadWriteData(this.dashboardFn);
    // Admin login (GET /admin, POST /admin/login, session cookie signing)
    // needs read on the admin-api-key-hash secret + write on fraud-events
    // (auditLog writes a record there on every login/logout/action). Without
    // these the dashboard 500s on login with AccessDeniedException.
    // grantWrite covers PutSecretValue for self-service password rotation.
    secrets.adminApiKeyHash.grantRead(this.dashboardFn);
    secrets.adminApiKeyHash.grantWrite(this.dashboardFn);
    tables.fraudEvents.grantReadWriteData(this.dashboardFn);
    tables.fraudTally.grantReadWriteData(this.dashboardFn);

    tables.payments.grantReadWriteData(this.apiFn);
    tables.tenants.grantReadWriteData(this.apiFn);
    tables.routes.grantReadWriteData(this.apiFn);
    tables.usage.grantReadWriteData(this.apiFn);
    tables.rateLimit.grantReadWriteData(this.apiFn);
    tables.idempotency.grantReadWriteData(this.apiFn);
    tables.fraudEvents.grantReadWriteData(this.apiFn);
    tables.fraudTally.grantReadWriteData(this.apiFn);
    tables.agentNonces.grantReadWriteData(this.apiFn);
    secrets.agentWallet.grantRead(this.apiFn);
    secrets.baseRpc.grantRead(this.apiFn);
    secrets.adminApiKeyHash.grantRead(this.apiFn);
    // Exchange secret grants intentionally NOT added — /v1/quote is unrouted
    // and the 5 exchange adapters are stubs. Re-grant when a real adapter ships.

    tables.tenants.grantReadWriteData(this.webhookFn);
    tables.webhookDlq.grantReadWriteData(this.webhookFn);
    secrets.stripeWebhook.grantRead(this.webhookFn);
    secrets.moonpay.grantRead(this.webhookFn);
    secrets.coinbase.grantRead(this.webhookFn);
    secrets.kraken.grantRead(this.webhookFn);
    secrets.binance.grantRead(this.webhookFn);
    secrets.uphold.grantRead(this.webhookFn);

    tables.tenants.grantReadWriteData(this.stripeWebhookFn);
    secrets.stripeWebhook.grantRead(this.stripeWebhookFn);

    tables.routes.grantReadData(this.fetchFn);
    tables.agentNonces.grantReadData(this.fetchFn);
    // fetchFn needs to WRITE payments + usage so x402 verification can
    // record settled payments (previously Read-only, which worked when
    // /v1/fetch required an API key -- the API-key auth path skipped the
    // record+increment. Now /v1/fetch is x402-only and records payments
    // directly inside fetchFn, so it needs write perms).
    tables.payments.grantReadWriteData(this.fetchFn);
    tables.usage.grantReadWriteData(this.fetchFn);
    tables.tenants.grantReadData(this.fetchFn);
    tables.rateLimit.grantReadWriteData(this.fetchFn);
    tables.idempotency.grantReadWriteData(this.fetchFn);
    // Fraud tracking (nonce-reuse tally) on x402 verification failures.
    tables.fraudTally.grantReadWriteData(this.fetchFn);
    tables.fraudEvents.grantReadWriteData(this.fetchFn);
    secrets.agentWallet.grantRead(this.fetchFn);
    secrets.baseRpc.grantRead(this.fetchFn);

    // --- EventBridge schedule ---
    new Rule(this, 'DlqSweepSchedule', {
      ruleName: `x402-dlq-sweep-${stage}`,
      description: 'Trigger DLQ sweep every 5 minutes',
      schedule: Schedule.rate(Duration.minutes(5)),
      targets: [new LambdaFunction(this.dlqSweepFn)],
    });

    this.allFns = [
      ['Api', this.apiFn],
      ['Webhook', this.webhookFn],
      ['StripeWebhook', this.stripeWebhookFn],
      ['Dashboard', this.dashboardFn],
      ['DlqSweep', this.dlqSweepFn],
      ['Fetch', this.fetchFn],
    ];
  }
}
