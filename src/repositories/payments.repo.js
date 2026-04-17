import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { ConflictError } from '../lib/errors.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: getConfig().awsRegion }));
const TABLE = process.env.PAYMENTS_TABLE ?? 'x402-payments';

export const paymentsRepo = {
  async getByNonce(nonce) {
    const res = await ddb.send(
      new GetCommand({ TableName: TABLE, Key: { idempotencyKey: nonce } }),
    );
    return res.Item;
  },

  async recordConfirmed(input) {
    const item = {
      idempotencyKey: input.idempotencyKey,
      accountId: input.accountId,
      amountWei: input.amountWei,
      assetSymbol: input.assetSymbol,
      txHash: input.txHash,
      blockNumber: input.blockNumber,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
    };
    if (input.resource) item.resource = input.resource;
    if (input.network) item.network = input.network;
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: item,
          ConditionExpression: 'attribute_not_exists(idempotencyKey)',
        }),
      );
    } catch (e) {
      if (e?.name === 'ConditionalCheckFailedException') {
        throw new ConflictError('nonce already used');
      }
      throw e;
    }
  },

  async scanAllConfirmed() {
    const items = [];
    let lastKey;
    do {
      const params = {
        TableName: TABLE,
        FilterExpression: '#s = :confirmed',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':confirmed': 'confirmed' },
      };
      if (lastKey) params.ExclusiveStartKey = lastKey;
      const res = await ddb.send(new ScanCommand(params));
      items.push(...(res.Items ?? []));
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return items;
  },

  async listByAccount(accountId, limit = 20, cursor) {
    const params = {
      TableName: TABLE,
      IndexName: 'gsi-accountId',
      KeyConditionExpression: 'accountId = :a',
      ExpressionAttributeValues: { ':a': accountId },
      ScanIndexForward: false,
      Limit: limit,
    };
    if (cursor) params.ExclusiveStartKey = cursor;

    const res = await ddb.send(new QueryCommand(params));
    return {
      items: res.Items ?? [],
      lastKey: res.LastEvaluatedKey ?? null,
    };
  },
};
