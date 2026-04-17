import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { RouteItem } from '../validators/route.schema.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: getConfig().awsRegion }));
const TABLE = process.env.ROUTES_TABLE ?? 'x402-routes';

export const routesRepo = {
  async getByTenantAndPath(tenantId, path) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { tenantId, path } }));
    if (!res.Item) throw new NotFoundError('Route');
    return RouteItem.parse(res.Item);
  },

  async listByTenant(tenantId) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'tenantId = :t',
        ExpressionAttributeValues: { ':t': tenantId },
      }),
    );
    return (res.Items ?? []).map((item) => RouteItem.parse(item));
  },

  async create(input) {
    const now = new Date().toISOString();
    const item = {
      tenantId: input.tenantId,
      path: input.path,
      priceWei: input.priceWei,
      asset: input.asset ?? 'USDC',
      fraudRules: input.fraudRules,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: item,
          ConditionExpression: 'attribute_not_exists(tenantId) AND attribute_not_exists(#p)',
          ExpressionAttributeNames: { '#p': 'path' },
        }),
      );
    } catch (e) {
      if (e?.name === 'ConditionalCheckFailedException') {
        throw new ConflictError('Route already exists for this tenant and path');
      }
      throw e;
    }
    return RouteItem.parse(item);
  },

  async update(tenantId, path, fields) {
    const existing = await this.getByTenantAndPath(tenantId, path);
    const now = new Date().toISOString();
    const item = {
      tenantId,
      path,
      priceWei: fields.priceWei,
      asset: fields.asset ?? 'USDC',
      fraudRules: fields.fraudRules,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    return RouteItem.parse(item);
  },

  async delete(tenantId, path) {
    const res = await ddb.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { tenantId, path },
        ReturnValues: 'ALL_OLD',
      }),
    );
    if (!res.Attributes) throw new NotFoundError('Route');
  },
};
