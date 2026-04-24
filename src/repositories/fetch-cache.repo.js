import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { sha256 } from '../lib/crypto.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: getConfig().awsRegion }));
const TABLE = process.env.FETCH_CACHE_TABLE ?? 'x402-fetch-cache';
const DEFAULT_TTL_SECONDS = Number(process.env.FETCH_CACHE_TTL_SECONDS) || 300;

export function cacheKey(url, mode) {
  return sha256(`${url}::${mode}`);
}

export const fetchCacheRepo = {
  async get(key) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { cacheKey: key } }));
    if (!res.Item) return null;
    const now = Math.floor(Date.now() / 1000);
    if (res.Item.ttl && res.Item.ttl <= now) return null;
    return res.Item;
  },

  async put(key, { url, mode, title, markdown, metadata }, ttlSeconds) {
    const ttl = ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const now = new Date();
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          cacheKey: key,
          url,
          mode,
          title,
          markdown,
          metadata: JSON.stringify(metadata),
          createdAt: now.toISOString(),
          ttl: Math.floor(now.getTime() / 1000) + ttl,
        },
      }),
    );
  },
};
