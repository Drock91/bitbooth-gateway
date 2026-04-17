import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { NotFoundError } from '../lib/errors.js';
import { WebhookDlqItem } from '../validators/webhook-dlq.schema.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: getConfig().awsRegion }));
const TABLE = process.env.WEBHOOK_DLQ_TABLE ?? 'x402-webhook-dlq';

const TTL_DAYS = Number(process.env.WEBHOOK_DLQ_TTL_DAYS) || 30;

export const webhookDlqRepo = {
  async record({ eventId, provider, payload, headers, errorMessage, errorCode }) {
    const now = new Date();
    const item = {
      eventId,
      provider,
      payload,
      headers,
      errorMessage,
      errorCode,
      status: 'pending',
      retryCount: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ttl: Math.floor(now.getTime() / 1000) + TTL_DAYS * 86400,
    };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    return WebhookDlqItem.parse(item);
  },

  async listByProvider(provider, limit = 20, cursor) {
    const params = {
      TableName: TABLE,
      IndexName: 'gsi-provider',
      KeyConditionExpression: 'provider = :p',
      ExpressionAttributeValues: { ':p': provider },
      ScanIndexForward: false,
      Limit: limit,
    };
    if (cursor) params.ExclusiveStartKey = cursor;
    const res = await ddb.send(new QueryCommand(params));
    return {
      items: (res.Items ?? []).map((i) => WebhookDlqItem.parse(i)),
      lastKey: res.LastEvaluatedKey ?? null,
    };
  },

  async listPending(limit = 20, cursor) {
    const params = {
      TableName: TABLE,
      IndexName: 'gsi-status',
      KeyConditionExpression: '#s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': 'pending' },
      ScanIndexForward: false,
      Limit: limit,
    };
    if (cursor) params.ExclusiveStartKey = cursor;
    const res = await ddb.send(new QueryCommand(params));
    return {
      items: (res.Items ?? []).map((i) => WebhookDlqItem.parse(i)),
      lastKey: res.LastEvaluatedKey ?? null,
    };
  },

  async incrementRetry(eventId) {
    const now = new Date().toISOString();
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { eventId },
        UpdateExpression: 'SET retryCount = retryCount + :one, updatedAt = :now',
        ConditionExpression: 'attribute_exists(eventId)',
        ExpressionAttributeValues: { ':one': 1, ':now': now },
        ReturnValues: 'ALL_NEW',
      }),
    );
    if (!res.Attributes) throw new NotFoundError('DLQ event');
    return WebhookDlqItem.parse(res.Attributes);
  },

  async updateStatus(eventId, status) {
    const now = new Date().toISOString();
    const update =
      status === 'retried'
        ? 'SET #s = :s, updatedAt = :now, retryCount = retryCount + :one'
        : 'SET #s = :s, updatedAt = :now';

    const values =
      status === 'retried'
        ? { ':s': status, ':now': now, ':one': 1 }
        : { ':s': status, ':now': now };

    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { eventId },
        UpdateExpression: update,
        ConditionExpression: 'attribute_exists(eventId)',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    if (!res.Attributes) throw new NotFoundError('DLQ event');
    return WebhookDlqItem.parse(res.Attributes);
  },
};
