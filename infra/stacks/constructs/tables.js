import { RemovalPolicy } from 'aws-cdk-lib';
import { Table, AttributeType, BillingMode, ProjectionType } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class Tables extends Construct {
  constructor(scope, id, { stage }) {
    super(scope, id);

    const retain = stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    this.payments = new Table(this, 'PaymentsTable', {
      tableName: `x402-payments-${stage}`,
      partitionKey: { name: 'idempotencyKey', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: retain,
    });
    this.payments.addGlobalSecondaryIndex({
      indexName: 'gsi-accountId',
      partitionKey: { name: 'accountId', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.tenants = new Table(this, 'TenantsTable', {
      tableName: `x402-tenants-${stage}`,
      partitionKey: { name: 'accountId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: retain,
    });
    this.tenants.addGlobalSecondaryIndex({
      indexName: 'gsi-apiKeyHash',
      partitionKey: { name: 'apiKeyHash', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.routes = new Table(this, 'RoutesTable', {
      tableName: `x402-routes-${stage}`,
      partitionKey: { name: 'tenantId', type: AttributeType.STRING },
      sortKey: { name: 'path', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: retain,
    });

    this.usage = new Table(this, 'UsageTable', {
      tableName: `x402-usage-${stage}`,
      partitionKey: { name: 'accountId', type: AttributeType.STRING },
      sortKey: { name: 'yearMonth', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: retain,
    });

    this.rateLimit = new Table(this, 'RateLimitTable', {
      tableName: `x402-rate-limits-${stage}`,
      partitionKey: { name: 'accountId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: retain,
    });

    this.idempotency = new Table(this, 'IdempotencyTable', {
      tableName: `x402-idempotency-${stage}`,
      partitionKey: { name: 'idempotencyKey', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
      removalPolicy: retain,
    });

    this.fraudEvents = new Table(this, 'FraudEventsTable', {
      tableName: `x402-fraud-events-${stage}`,
      partitionKey: { name: 'accountId', type: AttributeType.STRING },
      sortKey: { name: 'timestamp', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
      removalPolicy: retain,
    });

    this.fraudTally = new Table(this, 'FraudTallyTable', {
      tableName: `x402-fraud-tally-${stage}`,
      partitionKey: { name: 'accountId', type: AttributeType.STRING },
      sortKey: { name: 'windowKey', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
      removalPolicy: retain,
    });

    this.agentNonces = new Table(this, 'AgentNoncesTable', {
      tableName: `x402-agent-nonces-${stage}`,
      partitionKey: { name: 'walletAddress', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: retain,
    });

    this.webhookDlq = new Table(this, 'WebhookDlqTable', {
      tableName: `x402-webhook-dlq-${stage}`,
      partitionKey: { name: 'eventId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
      removalPolicy: retain,
    });
    this.webhookDlq.addGlobalSecondaryIndex({
      indexName: 'gsi-provider',
      partitionKey: { name: 'provider', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
    this.webhookDlq.addGlobalSecondaryIndex({
      indexName: 'gsi-status',
      partitionKey: { name: 'status', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.all = [
      ['Payments', this.payments],
      ['Tenants', this.tenants],
      ['Routes', this.routes],
      ['Usage', this.usage],
      ['RateLimit', this.rateLimit],
      ['Idempotency', this.idempotency],
      ['FraudEvents', this.fraudEvents],
      ['FraudTally', this.fraudTally],
      ['AgentNonces', this.agentNonces],
      ['WebhookDlq', this.webhookDlq],
    ];
  }
}
