import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { RateLimitBucket } from '../validators/rate-limit.schema.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: getConfig().awsRegion }));
const TABLE = process.env.RATE_LIMIT_TABLE ?? 'x402-rate-limits';

export const rateLimitRepo = {
  /**
   * Try to consume one token from the bucket. Refills tokens based on elapsed
   * time since last refill, then decrements by one. Uses optimistic concurrency
   * via a condition on lastRefillAt to prevent double-spend under race.
   *
   * @param {string} accountId
   * @param {number} capacity  – max tokens in bucket
   * @param {number} refillRate – tokens added per second
   * @returns {Promise<{tokens: number, capacity: number}>} remaining state after consume
   * @throws if bucket is empty (condition check fails)
   */
  async consume(accountId, capacity, refillRate) {
    const now = new Date();
    const bucket = await this.getBucket(accountId);

    if (!bucket) {
      // First request — initialise bucket with capacity - 1 (consumed one token)
      const item = {
        accountId,
        tokens: capacity - 1,
        lastRefillAt: now.toISOString(),
        capacity,
        refillRate,
      };
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: item,
          ConditionExpression: 'attribute_not_exists(accountId)',
        }),
      );
      return RateLimitBucket.parse(item);
    }

    const elapsedMs = now.getTime() - new Date(bucket.lastRefillAt).getTime();
    const elapsedSec = elapsedMs / 1000;
    const refilled = Math.min(capacity, bucket.tokens + elapsedSec * refillRate);
    const afterConsume = refilled - 1;

    if (afterConsume < 0) {
      return null; // no tokens available
    }

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { accountId },
        // `capacity` is a DDB reserved keyword — alias it via #cap.
        UpdateExpression: 'SET tokens = :t, lastRefillAt = :now, #cap = :c, refillRate = :r',
        ConditionExpression: 'lastRefillAt = :oldRefill',
        ExpressionAttributeNames: {
          '#cap': 'capacity',
        },
        ExpressionAttributeValues: {
          ':t': afterConsume,
          ':now': now.toISOString(),
          ':c': capacity,
          ':r': refillRate,
          ':oldRefill': bucket.lastRefillAt,
        },
      }),
    );

    return RateLimitBucket.parse({
      accountId,
      tokens: afterConsume,
      lastRefillAt: now.toISOString(),
      capacity,
      refillRate,
    });
  },

  async getBucket(accountId) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { accountId } }));
    if (!res.Item) return null;
    return RateLimitBucket.parse(res.Item);
  },
};
