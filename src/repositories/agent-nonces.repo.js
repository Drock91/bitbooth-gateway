import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { AgentNonceItem } from '../validators/agent-nonce.schema.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: getConfig().awsRegion }));
const TABLE = process.env.AGENT_NONCES_TABLE ?? 'x402-agent-nonces';

export const agentNoncesRepo = {
  /** Read the current nonce without incrementing. */
  async getCurrentNonce(walletAddress) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { walletAddress } }));
    if (!res.Item) throw new NotFoundError('AgentNonce');
    return AgentNonceItem.parse(res.Item);
  },

  /**
   * Atomically claim the next nonce for a wallet.
   * Uses DDB ADD to increment currentNonce by 1 and returns the value *before* increment
   * (i.e. the nonce to use for the tx).
   */
  async getNextNonce(walletAddress) {
    const now = new Date().toISOString();
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { walletAddress },
        UpdateExpression: 'ADD currentNonce :inc SET lastUsedAt = :now',
        ExpressionAttributeValues: { ':inc': 1, ':now': now },
        ConditionExpression: 'attribute_exists(walletAddress)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    const item = AgentNonceItem.parse(res.Attributes);
    // currentNonce after ADD is N+1, so the nonce to use is N+1-1 = N
    return { nonce: item.currentNonce - 1, item };
  },

  /**
   * Seed a wallet's nonce (e.g. from chain's getTransactionCount on cold start).
   * Fails with ConflictError if already initialized.
   */
  async initializeNonce(walletAddress, startNonce) {
    const now = new Date().toISOString();
    const item = { walletAddress, currentNonce: startNonce, lastUsedAt: now };
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: item,
          ConditionExpression: 'attribute_not_exists(walletAddress)',
        }),
      );
    } catch (e) {
      if (e?.name === 'ConditionalCheckFailedException') {
        throw new ConflictError('Agent nonce already initialized for this wallet');
      }
      throw e;
    }
    return AgentNonceItem.parse(item);
  },
};
