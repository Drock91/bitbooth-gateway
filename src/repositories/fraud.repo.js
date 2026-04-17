import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { FraudEvent, FraudTally } from '../validators/fraud.schema.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: getConfig().awsRegion }));
const EVENTS_TABLE = process.env.FRAUD_EVENTS_TABLE ?? 'x402-fraud-events';
const TALLY_TABLE = process.env.FRAUD_TALLY_TABLE ?? 'x402-fraud-tally';

const TTL_DAYS = Number(process.env.FRAUD_EVENT_TTL_DAYS) || 30;

export const fraudRepo = {
  /**
   * Record a fraud event. TTL auto-expires after 30 days.
   * PK: accountId, SK: timestamp
   */
  async recordEvent({ accountId, eventType, severity, details }) {
    const now = new Date();
    const item = {
      accountId,
      timestamp: now.toISOString(),
      eventType,
      severity,
      details,
      ttl: Math.floor(now.getTime() / 1000) + TTL_DAYS * 86400,
    };
    await ddb.send(new PutCommand({ TableName: EVENTS_TABLE, Item: item }));
    return FraudEvent.parse(item);
  },

  /**
   * List recent fraud events for an account, newest first.
   */
  async listByAccount(accountId, limit = 20) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: EVENTS_TABLE,
        KeyConditionExpression: 'accountId = :a',
        ExpressionAttributeValues: { ':a': accountId },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (res.Items ?? []).map((i) => FraudEvent.parse(i));
  },

  /**
   * Atomically increment a tally counter for a time window.
   * PK: accountId, SK: windowKey (e.g. "velocity:2026-04-05T12:05")
   * Returns the new count after increment.
   */
  async scanEventsSince(sinceIso) {
    const items = [];
    let lastKey;
    do {
      const params = {
        TableName: EVENTS_TABLE,
        FilterExpression: '#ts >= :since',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: { ':since': sinceIso },
      };
      if (lastKey) params.ExclusiveStartKey = lastKey;
      const res = await ddb.send(new ScanCommand(params));
      items.push(...(res.Items ?? []));
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return items;
  },

  async incrementTally(accountId, windowKey) {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TALLY_TABLE,
        Key: { accountId, windowKey },
        UpdateExpression:
          'SET eventCount = if_not_exists(eventCount, :zero) + :one, lastEventAt = :now, #ttl = :ttlVal',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':zero': 0,
          ':one': 1,
          ':now': new Date().toISOString(),
          ':ttlVal': Math.floor(Date.now() / 1000) + 3600,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return FraudTally.parse(res.Attributes);
  },

  /**
   * Get the current tally for a specific window.
   */
  async getTally(accountId, windowKey) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TALLY_TABLE,
        KeyConditionExpression: 'accountId = :a AND windowKey = :w',
        ExpressionAttributeValues: { ':a': accountId, ':w': windowKey },
        Limit: 1,
      }),
    );
    if (!res.Items?.length) return { accountId, windowKey, eventCount: 0 };
    return FraudTally.parse(res.Items[0]);
  },
};
