import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { TenantItem } from '../validators/tenant.schema.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: getConfig().awsRegion }));
const TABLE = process.env.TENANTS_TABLE ?? 'x402-tenants';

export const tenantsRepo = {
  async getByAccountId(accountId) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { accountId } }));
    if (!res.Item) throw new NotFoundError('Tenant');
    return TenantItem.parse(res.Item);
  },

  async getByApiKeyHash(apiKeyHash) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'gsi-apiKeyHash',
        KeyConditionExpression: 'apiKeyHash = :h',
        ExpressionAttributeValues: { ':h': apiKeyHash },
        Limit: 1,
      }),
    );
    if (!res.Items?.length) return null;
    return TenantItem.parse(res.Items[0]);
  },

  async create(input) {
    const item = {
      accountId: input.accountId,
      apiKeyHash: input.apiKeyHash,
      stripeCustomerId: input.stripeCustomerId,
      plan: input.plan ?? 'free',
      createdAt: new Date().toISOString(),
    };
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: item,
          ConditionExpression: 'attribute_not_exists(accountId)',
        }),
      );
    } catch (e) {
      if (e?.name === 'ConditionalCheckFailedException') {
        throw new ConflictError('Tenant already exists');
      }
      throw e;
    }
    return TenantItem.parse(item);
  },

  async getByStripeCustomerId(stripeCustomerId) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'gsi-stripeCustomerId',
        KeyConditionExpression: 'stripeCustomerId = :c',
        ExpressionAttributeValues: { ':c': stripeCustomerId },
        Limit: 1,
      }),
    );
    if (!res.Items?.length) return null;
    return TenantItem.parse(res.Items[0]);
  },

  async updateApiKeyHash(accountId, apiKeyHash) {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { accountId },
        UpdateExpression: 'SET apiKeyHash = :h',
        ExpressionAttributeValues: { ':h': apiKeyHash },
        ConditionExpression: 'attribute_exists(accountId)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return TenantItem.parse(res.Attributes);
  },

  async listAll(limit = 20, startKey, plan) {
    const params = {
      TableName: TABLE,
      Limit: limit,
    };
    if (startKey) params.ExclusiveStartKey = startKey;
    if (plan) {
      params.FilterExpression = '#p = :p';
      params.ExpressionAttributeNames = { '#p': 'plan' };
      params.ExpressionAttributeValues = { ':p': plan };
    }
    const res = await ddb.send(new ScanCommand(params));
    return {
      items: (res.Items ?? []).map((i) => TenantItem.parse(i)),
      lastKey: res.LastEvaluatedKey ?? null,
    };
  },

  async updateStatus(accountId, status) {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { accountId },
        UpdateExpression: 'SET #s = :s',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': status },
        ConditionExpression: 'attribute_exists(accountId)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return TenantItem.parse(res.Attributes);
  },

  async updatePlan(accountId, plan) {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { accountId },
        UpdateExpression: 'SET #p = :p',
        ExpressionAttributeNames: { '#p': 'plan' },
        ExpressionAttributeValues: { ':p': plan },
        ConditionExpression: 'attribute_exists(accountId)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return TenantItem.parse(res.Attributes);
  },
};
