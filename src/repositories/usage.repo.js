import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: getConfig().awsRegion }));
const TABLE = process.env.USAGE_TABLE ?? 'x402-usage';

export const usageRepo = {
  /**
   * Atomically increment the call count for a tenant in the current billing period.
   * Creates the item if it doesn't exist yet.
   */
  async increment(accountId, { resource, txHash }) {
    const yearMonth = new Date().toISOString().slice(0, 7);
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { accountId, yearMonth },
        UpdateExpression:
          'SET callCount = if_not_exists(callCount, :zero) + :one, lastCallAt = :now ADD resources :res, txHashes :tx',
        ExpressionAttributeValues: {
          ':zero': 0,
          ':one': 1,
          ':now': new Date().toISOString(),
          ':res': new Set([resource]),
          ':tx': new Set([txHash]),
        },
      }),
    );
  },

  async getForPeriod(accountId, yearMonth) {
    const res = await ddb.send(
      new GetCommand({
        TableName: TABLE,
        Key: { accountId, yearMonth },
      }),
    );
    return res.Item ?? { accountId, yearMonth, callCount: 0 };
  },

  async listByAccount(accountId, limit = 12) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'accountId = :a',
        ExpressionAttributeValues: { ':a': accountId },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return res.Items ?? [];
  },
};
