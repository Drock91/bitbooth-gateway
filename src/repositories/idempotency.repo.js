import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { ConflictError } from '../lib/errors.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: getConfig().awsRegion }));
const TABLE = process.env.IDEMPOTENCY_TABLE ?? 'x402-idempotency';
const TTL_SECONDS = Number(process.env.IDEMPOTENCY_TTL_SECONDS) || 24 * 60 * 60;

export const idempotencyRepo = {
  async get(idempotencyKey) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { idempotencyKey } }));
    return res.Item ?? null;
  },

  async lockKey(idempotencyKey) {
    const now = new Date();
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            idempotencyKey,
            status: 'in_progress',
            createdAt: now.toISOString(),
            ttl: Math.floor(now.getTime() / 1000) + TTL_SECONDS,
          },
          ConditionExpression: 'attribute_not_exists(idempotencyKey)',
        }),
      );
    } catch (e) {
      if (e?.name === 'ConditionalCheckFailedException') {
        throw new ConflictError('idempotency key already in use');
      }
      throw e;
    }
  },

  async complete(idempotencyKey, statusCode, responseBody, responseHeaders) {
    const now = new Date();
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { idempotencyKey },
        UpdateExpression:
          'SET #s = :s, statusCode = :sc, responseBody = :rb, responseHeaders = :rh, completedAt = :ca, #t = :t',
        ExpressionAttributeNames: { '#s': 'status', '#t': 'ttl' },
        ExpressionAttributeValues: {
          ':s': 'completed',
          ':sc': statusCode,
          ':rb': responseBody,
          ':rh': responseHeaders,
          ':ca': now.toISOString(),
          ':t': Math.floor(now.getTime() / 1000) + TTL_SECONDS,
        },
      }),
    );
  },

  async release(idempotencyKey) {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { idempotencyKey } }));
  },
};
