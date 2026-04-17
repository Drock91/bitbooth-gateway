import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';

const endpoint = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const region = process.env.AWS_REGION ?? 'us-east-1';

export const ddbClient = new DynamoDBClient({
  region,
  endpoint,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

export const TABLE_DEFS = {
  tenants: {
    TableName: 'x402-tenants',
    KeySchema: [{ AttributeName: 'accountId', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'accountId', AttributeType: 'S' },
      { AttributeName: 'apiKeyHash', AttributeType: 'S' },
      { AttributeName: 'stripeCustomerId', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
    GlobalSecondaryIndexes: [
      {
        IndexName: 'gsi-apiKeyHash',
        KeySchema: [{ AttributeName: 'apiKeyHash', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'gsi-stripeCustomerId',
        KeySchema: [{ AttributeName: 'stripeCustomerId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  routes: {
    TableName: 'x402-routes',
    KeySchema: [
      { AttributeName: 'tenantId', KeyType: 'HASH' },
      { AttributeName: 'path', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'tenantId', AttributeType: 'S' },
      { AttributeName: 'path', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  payments: {
    TableName: 'x402-payments',
    KeySchema: [{ AttributeName: 'idempotencyKey', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'idempotencyKey', AttributeType: 'S' },
      { AttributeName: 'accountId', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
    GlobalSecondaryIndexes: [
      {
        IndexName: 'gsi-accountId',
        KeySchema: [{ AttributeName: 'accountId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  usage: {
    TableName: 'x402-usage',
    KeySchema: [
      { AttributeName: 'accountId', KeyType: 'HASH' },
      { AttributeName: 'yearMonth', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'accountId', AttributeType: 'S' },
      { AttributeName: 'yearMonth', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  'fraud-tally': {
    TableName: 'x402-fraud-tally',
    KeySchema: [
      { AttributeName: 'accountId', KeyType: 'HASH' },
      { AttributeName: 'windowKey', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'accountId', AttributeType: 'S' },
      { AttributeName: 'windowKey', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  'fraud-events': {
    TableName: 'x402-fraud-events',
    KeySchema: [
      { AttributeName: 'accountId', KeyType: 'HASH' },
      { AttributeName: 'timestamp', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'accountId', AttributeType: 'S' },
      { AttributeName: 'timestamp', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  'rate-limits': {
    TableName: 'x402-rate-limits',
    KeySchema: [{ AttributeName: 'accountId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'accountId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  idempotency: {
    TableName: 'x402-idempotency',
    KeySchema: [{ AttributeName: 'idempotencyKey', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'idempotencyKey', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  'agent-nonces': {
    TableName: 'x402-agent-nonces',
    KeySchema: [{ AttributeName: 'walletAddress', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'walletAddress', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  'webhook-dlq': {
    TableName: 'x402-webhook-dlq',
    KeySchema: [{ AttributeName: 'eventId', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'eventId', AttributeType: 'S' },
      { AttributeName: 'provider', AttributeType: 'S' },
      { AttributeName: 'status', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
    GlobalSecondaryIndexes: [
      {
        IndexName: 'gsi-provider',
        KeySchema: [
          { AttributeName: 'provider', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'gsi-status',
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
};

async function tableExists(tableName) {
  try {
    await ddbClient.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') return false;
    throw e;
  }
}

export async function createTable(key) {
  const def = TABLE_DEFS[key];
  if (!def) throw new Error(`Unknown table key: ${key}`);
  if (await tableExists(def.TableName)) {
    await ddbClient.send(new DeleteTableCommand({ TableName: def.TableName }));
  }
  await ddbClient.send(new CreateTableCommand(def));
}

export async function destroyTable(key) {
  const def = TABLE_DEFS[key];
  if (!def) throw new Error(`Unknown table key: ${key}`);
  try {
    await ddbClient.send(new DeleteTableCommand({ TableName: def.TableName }));
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') return;
    throw e;
  }
}

export async function isLocalStackUp() {
  try {
    await ddbClient.send(new DescribeTableCommand({ TableName: '__ping__' }));
    return true;
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') return true;
    return false;
  }
}
