import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  GetCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Get', ...p });
  }),
  PutCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Put', ...p });
  }),
  UpdateCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Update', ...p });
  }),
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({ awsRegion: 'us-east-1' }),
}));

import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { agentNoncesRepo } from '../../src/repositories/agent-nonces.repo.js';
import { NotFoundError, ConflictError } from '../../src/lib/errors.js';

const WALLET = '0x1234567890abcdef1234567890abcdef12345678';
const NOW = '2026-04-06T00:00:00.000Z';

const validItem = {
  walletAddress: WALLET,
  currentNonce: 5,
  lastUsedAt: NOW,
};

describe('agentNoncesRepo', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('getCurrentNonce', () => {
    it('returns validated item when found', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validItem } });
      const result = await agentNoncesRepo.getCurrentNonce(WALLET);
      expect(result.walletAddress).toBe(WALLET);
      expect(result.currentNonce).toBe(5);
    });

    it('throws NotFoundError when item is missing', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      await expect(agentNoncesRepo.getCurrentNonce(WALLET)).rejects.toThrow('AgentNonce not found');
    });

    it('throws NotFoundError instance', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      await expect(agentNoncesRepo.getCurrentNonce(WALLET)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('sends GetCommand with correct table and key', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validItem } });
      await agentNoncesRepo.getCurrentNonce(WALLET);
      expect(GetCommand).toHaveBeenCalledWith({
        TableName: 'x402-agent-nonces',
        Key: { walletAddress: WALLET },
      });
    });

    it('rejects items with invalid walletAddress via Zod', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validItem, walletAddress: 'bad' } });
      await expect(agentNoncesRepo.getCurrentNonce(WALLET)).rejects.toThrow();
    });

    it('rejects items with negative nonce via Zod', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validItem, currentNonce: -1 } });
      await expect(agentNoncesRepo.getCurrentNonce(WALLET)).rejects.toThrow();
    });

    it('accepts nonce of zero', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validItem, currentNonce: 0 } });
      const result = await agentNoncesRepo.getCurrentNonce(WALLET);
      expect(result.currentNonce).toBe(0);
    });

    it('propagates DDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('service unavailable'));
      await expect(agentNoncesRepo.getCurrentNonce(WALLET)).rejects.toThrow('service unavailable');
    });
  });

  describe('getNextNonce', () => {
    it('returns the nonce to use (currentNonce - 1 after ADD)', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: { ...validItem, currentNonce: 6 } });
      const { nonce } = await agentNoncesRepo.getNextNonce(WALLET);
      expect(nonce).toBe(5);
    });

    it('returns the full item', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: { ...validItem, currentNonce: 6 } });
      const { item } = await agentNoncesRepo.getNextNonce(WALLET);
      expect(item.walletAddress).toBe(WALLET);
      expect(item.currentNonce).toBe(6);
    });

    it('sends UpdateCommand with ADD and condition', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: { ...validItem, currentNonce: 1 } });
      await agentNoncesRepo.getNextNonce(WALLET);
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'x402-agent-nonces',
          Key: { walletAddress: WALLET },
          UpdateExpression: 'ADD currentNonce :inc SET lastUsedAt = :now',
          ConditionExpression: 'attribute_exists(walletAddress)',
          ReturnValues: 'ALL_NEW',
        }),
      );
    });

    it('passes increment of 1 in expression values', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: { ...validItem, currentNonce: 1 } });
      await agentNoncesRepo.getNextNonce(WALLET);
      const call = UpdateCommand.mock.calls[0][0];
      expect(call.ExpressionAttributeValues[':inc']).toBe(1);
    });

    it('sets lastUsedAt to an ISO datetime string', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: { ...validItem, currentNonce: 1 } });
      await agentNoncesRepo.getNextNonce(WALLET);
      const call = UpdateCommand.mock.calls[0][0];
      expect(call.ExpressionAttributeValues[':now']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('propagates ConditionalCheckFailedException (wallet not initialized)', async () => {
      const err = new Error('conditional');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);
      await expect(agentNoncesRepo.getNextNonce(WALLET)).rejects.toThrow('conditional');
    });

    it('handles nonce starting from 0 (first tx)', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: { ...validItem, currentNonce: 1 } });
      const { nonce } = await agentNoncesRepo.getNextNonce(WALLET);
      expect(nonce).toBe(0);
    });
  });

  describe('initializeNonce', () => {
    it('creates item and returns validated result', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await agentNoncesRepo.initializeNonce(WALLET, 0);
      expect(result.walletAddress).toBe(WALLET);
      expect(result.currentNonce).toBe(0);
      expect(result.lastUsedAt).toBeDefined();
    });

    it('accepts nonzero starting nonce', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await agentNoncesRepo.initializeNonce(WALLET, 42);
      expect(result.currentNonce).toBe(42);
    });

    it('sends PutCommand with condition to prevent overwrite', async () => {
      mockSend.mockResolvedValueOnce({});
      await agentNoncesRepo.initializeNonce(WALLET, 10);
      expect(PutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'x402-agent-nonces',
          ConditionExpression: 'attribute_not_exists(walletAddress)',
        }),
      );
    });

    it('writes correct item shape', async () => {
      mockSend.mockResolvedValueOnce({});
      await agentNoncesRepo.initializeNonce(WALLET, 7);
      const call = PutCommand.mock.lastCall[0];
      expect(call.Item.walletAddress).toBe(WALLET);
      expect(call.Item.currentNonce).toBe(7);
      expect(call.Item.lastUsedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('throws ConflictError when wallet already initialized', async () => {
      const err = new Error('conditional');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);
      await expect(agentNoncesRepo.initializeNonce(WALLET, 0)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('throws ConflictError with descriptive message', async () => {
      const err = new Error('conditional');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);
      await expect(agentNoncesRepo.initializeNonce(WALLET, 0)).rejects.toThrow(
        'already initialized',
      );
    });

    it('re-throws unexpected errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('throttled'));
      await expect(agentNoncesRepo.initializeNonce(WALLET, 0)).rejects.toThrow('throttled');
    });
  });

  describe('table name', () => {
    it('defaults to x402-agent-nonces when env var is unset', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validItem } });
      await agentNoncesRepo.getCurrentNonce(WALLET);
      expect(GetCommand).toHaveBeenCalledWith(
        expect.objectContaining({ TableName: 'x402-agent-nonces' }),
      );
    });
  });
});
