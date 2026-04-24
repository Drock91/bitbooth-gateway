import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Tables } from '../../infra/stacks/constructs/tables.js';

function buildStack(stage = 'dev') {
  const app = new App();
  const stack = new Stack(app, `TablesTest-${stage}-${Date.now()}`);
  const tables = new Tables(stack, 'Tables', { stage });
  const template = Template.fromStack(stack);
  return { stack, tables, template };
}

function allTables(template) {
  return template.findResources('AWS::DynamoDB::Table');
}

function tableByName(template, nameFragment) {
  const entries = Object.entries(allTables(template));
  return entries.find(([, r]) => r.Properties.TableName.includes(nameFragment));
}

// ── Table count ──

describe('Tables construct — table count', () => {
  const { template } = buildStack();

  it('creates exactly 11 DynamoDB tables', () => {
    const count = Object.keys(allTables(template)).length;
    expect(count).toBe(11);
  });
});

// ── Table names ──

describe('Tables construct — table names', () => {
  const { template } = buildStack('staging');
  const names = Object.values(allTables(template))
    .map((r) => r.Properties.TableName)
    .sort();

  it('names every table with x402- prefix and stage suffix', () => {
    for (const name of names) {
      expect(name).toMatch(/^x402-.+-staging$/);
    }
  });

  it.each([
    'x402-payments-staging',
    'x402-tenants-staging',
    'x402-routes-staging',
    'x402-usage-staging',
    'x402-rate-limits-staging',
    'x402-idempotency-staging',
    'x402-fraud-events-staging',
    'x402-fraud-tally-staging',
    'x402-agent-nonces-staging',
    'x402-webhook-dlq-staging',
    'x402-fetch-cache-staging',
  ])('creates table %s', (expected) => {
    expect(names).toContain(expected);
  });
});

// ── Billing mode ──

describe('Tables construct — billing mode', () => {
  const { template } = buildStack();

  it('sets PAY_PER_REQUEST on all tables', () => {
    template.allResourcesProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });
});

// ── Point-in-time recovery ──

describe('Tables construct — PITR', () => {
  const { template } = buildStack();

  it('enables PITR on all 10 tables', () => {
    template.allResourcesProperties('AWS::DynamoDB::Table', {
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });
});

// ── Partition keys ──

describe('Tables construct — partition keys', () => {
  const { template } = buildStack();

  it.each([
    ['payments', 'idempotencyKey'],
    ['tenants', 'accountId'],
    ['routes', 'tenantId'],
    ['usage', 'accountId'],
    ['rate-limits', 'accountId'],
    ['idempotency', 'idempotencyKey'],
    ['fraud-events', 'accountId'],
    ['fraud-tally', 'accountId'],
    ['agent-nonces', 'walletAddress'],
    ['webhook-dlq', 'eventId'],
  ])('%s table has partition key %s', (tableName, pk) => {
    const [, resource] = tableByName(template, tableName);
    const hashKey = resource.Properties.KeySchema.find((k) => k.KeyType === 'HASH');
    expect(hashKey.AttributeName).toBe(pk);
  });
});

// ── Sort keys ──

describe('Tables construct — sort keys', () => {
  it.each([
    ['routes', 'path'],
    ['usage', 'yearMonth'],
    ['fraud-events', 'timestamp'],
    ['fraud-tally', 'windowKey'],
  ])('%s table has sort key %s', (tableName, sk) => {
    const { template } = buildStack();
    const [, resource] = tableByName(template, tableName);
    const rangeKey = resource.Properties.KeySchema.find((k) => k.KeyType === 'RANGE');
    expect(rangeKey.AttributeName).toBe(sk);
  });

  it.each(['payments', 'tenants', 'rate-limits', 'idempotency', 'agent-nonces', 'webhook-dlq'])(
    '%s table has no sort key',
    (tableName) => {
      const { template } = buildStack();
      const [, resource] = tableByName(template, tableName);
      const rangeKey = resource.Properties.KeySchema.find((k) => k.KeyType === 'RANGE');
      expect(rangeKey).toBeUndefined();
    },
  );
});

// ── TTL attributes ──

describe('Tables construct — TTL', () => {
  it.each(['idempotency', 'fraud-events', 'fraud-tally', 'webhook-dlq'])(
    '%s table has TTL attribute "ttl"',
    (tableName) => {
      const { template } = buildStack();
      const [, resource] = tableByName(template, tableName);
      expect(resource.Properties.TimeToLiveSpecification).toEqual({
        AttributeName: 'ttl',
        Enabled: true,
      });
    },
  );

  it.each(['payments', 'tenants', 'routes', 'usage', 'rate-limits', 'agent-nonces'])(
    '%s table has no TTL',
    (tableName) => {
      const { template } = buildStack();
      const [, resource] = tableByName(template, tableName);
      expect(resource.Properties.TimeToLiveSpecification).toBeUndefined();
    },
  );
});

// ── GSI indexes ──

describe('Tables construct — GSIs', () => {
  it('payments table has gsi-accountId with accountId PK and createdAt SK', () => {
    const { template } = buildStack();
    const [, resource] = tableByName(template, 'payments');
    const gsi = resource.Properties.GlobalSecondaryIndexes;
    expect(gsi).toHaveLength(1);
    expect(gsi[0].IndexName).toBe('gsi-accountId');
    const pk = gsi[0].KeySchema.find((k) => k.KeyType === 'HASH');
    const sk = gsi[0].KeySchema.find((k) => k.KeyType === 'RANGE');
    expect(pk.AttributeName).toBe('accountId');
    expect(sk.AttributeName).toBe('createdAt');
    expect(gsi[0].Projection.ProjectionType).toBe('ALL');
  });

  it('tenants table has gsi-apiKeyHash with apiKeyHash PK and no SK', () => {
    const { template } = buildStack();
    const [, resource] = tableByName(template, 'tenants');
    const gsi = resource.Properties.GlobalSecondaryIndexes;
    expect(gsi).toHaveLength(1);
    expect(gsi[0].IndexName).toBe('gsi-apiKeyHash');
    const pk = gsi[0].KeySchema.find((k) => k.KeyType === 'HASH');
    const sk = gsi[0].KeySchema.find((k) => k.KeyType === 'RANGE');
    expect(pk.AttributeName).toBe('apiKeyHash');
    expect(sk).toBeUndefined();
    expect(gsi[0].Projection.ProjectionType).toBe('ALL');
  });

  it('webhookDlq table has gsi-provider and gsi-status indexes', () => {
    const { template } = buildStack();
    const [, resource] = tableByName(template, 'webhook-dlq');
    const gsis = resource.Properties.GlobalSecondaryIndexes;
    expect(gsis).toHaveLength(2);

    const providerGsi = gsis.find((g) => g.IndexName === 'gsi-provider');
    expect(providerGsi).toBeDefined();
    expect(providerGsi.KeySchema.find((k) => k.KeyType === 'HASH').AttributeName).toBe('provider');
    expect(providerGsi.KeySchema.find((k) => k.KeyType === 'RANGE').AttributeName).toBe(
      'createdAt',
    );
    expect(providerGsi.Projection.ProjectionType).toBe('ALL');

    const statusGsi = gsis.find((g) => g.IndexName === 'gsi-status');
    expect(statusGsi).toBeDefined();
    expect(statusGsi.KeySchema.find((k) => k.KeyType === 'HASH').AttributeName).toBe('status');
    expect(statusGsi.KeySchema.find((k) => k.KeyType === 'RANGE').AttributeName).toBe('createdAt');
    expect(statusGsi.Projection.ProjectionType).toBe('ALL');
  });

  it.each([
    'routes',
    'usage',
    'rate-limits',
    'idempotency',
    'fraud-events',
    'fraud-tally',
    'agent-nonces',
  ])('%s table has no GSIs', (tableName) => {
    const { template } = buildStack();
    const [, resource] = tableByName(template, tableName);
    expect(resource.Properties.GlobalSecondaryIndexes).toBeUndefined();
  });
});

// ── Removal policy per stage ──

describe('Tables construct — removal policy', () => {
  it('dev stage sets DeletionPolicy to Delete on all tables', () => {
    const { template } = buildStack('dev');
    const tables = allTables(template);
    for (const [, resource] of Object.entries(tables)) {
      expect(resource.DeletionPolicy).toBe('Delete');
    }
  });

  it('prod stage sets DeletionPolicy to Retain on all tables', () => {
    const { template } = buildStack('prod');
    const tables = allTables(template);
    for (const [, resource] of Object.entries(tables)) {
      expect(resource.DeletionPolicy).toBe('Retain');
    }
  });

  it('staging stage sets DeletionPolicy to Delete', () => {
    const { template } = buildStack('staging');
    const tables = allTables(template);
    for (const [, resource] of Object.entries(tables)) {
      expect(resource.DeletionPolicy).toBe('Delete');
    }
  });
});

// ── this.all array ──

describe('Tables construct — this.all accessor', () => {
  const { tables } = buildStack();

  it('exposes all 11 tables in this.all', () => {
    expect(tables.all).toHaveLength(11);
  });

  it('this.all entries are [name, Table] pairs', () => {
    const expectedNames = [
      'Payments',
      'Tenants',
      'Routes',
      'Usage',
      'RateLimit',
      'Idempotency',
      'FraudEvents',
      'FraudTally',
      'AgentNonces',
      'WebhookDlq',
      'FetchCache',
    ];
    const names = tables.all.map(([name]) => name);
    expect(names).toEqual(expectedNames);
  });

  it('each this.all entry references the correct table property', () => {
    const map = {
      Payments: tables.payments,
      Tenants: tables.tenants,
      Routes: tables.routes,
      Usage: tables.usage,
      RateLimit: tables.rateLimit,
      Idempotency: tables.idempotency,
      FraudEvents: tables.fraudEvents,
      FraudTally: tables.fraudTally,
      AgentNonces: tables.agentNonces,
      WebhookDlq: tables.webhookDlq,
      FetchCache: tables.fetchCache,
    };
    for (const [name, table] of tables.all) {
      expect(table).toBe(map[name]);
    }
  });
});
