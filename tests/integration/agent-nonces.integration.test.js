import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ScanCommand } from '@aws-sdk/client-dynamodb';

let available = false;
let agentNoncesRepo;

const WALLET_A = '0x' + 'a'.repeat(40);
const WALLET_B = '0x' + 'b'.repeat(40);

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;
  await createTable('agent-nonces');
  const mod = await import('../../src/repositories/agent-nonces.repo.js');
  agentNoncesRepo = mod.agentNoncesRepo;
});

afterAll(async () => {
  if (available) await destroyTable('agent-nonces');
});

async function clearTable() {
  const res = await ddbClient.send(new ScanCommand({ TableName: 'x402-agent-nonces' }));
  if (!res.Items?.length) return;
  const docClient = DynamoDBDocumentClient.from(ddbClient);
  for (const item of res.Items) {
    await docClient.send(
      new DeleteCommand({
        TableName: 'x402-agent-nonces',
        Key: { walletAddress: item.walletAddress.S },
      }),
    );
  }
}

describe('agent-nonces.repo integration', () => {
  beforeEach(async () => {
    if (!available) return;
    await clearTable();
  });

  // --- initializeNonce ---

  it.skipIf(!available)('initializes a wallet with nonce 0', async () => {
    const result = await agentNoncesRepo.initializeNonce(WALLET_A, 0);

    expect(result.walletAddress).toBe(WALLET_A);
    expect(result.currentNonce).toBe(0);
    expect(result.lastUsedAt).toBeTruthy();
  });

  it.skipIf(!available)('initializes a wallet with a non-zero start nonce', async () => {
    const result = await agentNoncesRepo.initializeNonce(WALLET_A, 42);

    expect(result.currentNonce).toBe(42);
  });

  it.skipIf(!available)('throws ConflictError on duplicate initialization', async () => {
    await agentNoncesRepo.initializeNonce(WALLET_A, 0);

    await expect(agentNoncesRepo.initializeNonce(WALLET_A, 5)).rejects.toThrow(
      'already initialized',
    );
  });

  it.skipIf(!available)('allows initializing different wallets independently', async () => {
    const a = await agentNoncesRepo.initializeNonce(WALLET_A, 10);
    const b = await agentNoncesRepo.initializeNonce(WALLET_B, 20);

    expect(a.currentNonce).toBe(10);
    expect(b.currentNonce).toBe(20);
  });

  // --- getCurrentNonce ---

  it.skipIf(!available)('retrieves nonce after initialization', async () => {
    await agentNoncesRepo.initializeNonce(WALLET_A, 7);

    const result = await agentNoncesRepo.getCurrentNonce(WALLET_A);

    expect(result.walletAddress).toBe(WALLET_A);
    expect(result.currentNonce).toBe(7);
  });

  it.skipIf(!available)('throws NotFoundError for unknown wallet', async () => {
    await expect(agentNoncesRepo.getCurrentNonce(WALLET_A)).rejects.toThrow('AgentNonce');
  });

  it.skipIf(!available)('getCurrentNonce does not modify the nonce', async () => {
    await agentNoncesRepo.initializeNonce(WALLET_A, 5);

    await agentNoncesRepo.getCurrentNonce(WALLET_A);
    await agentNoncesRepo.getCurrentNonce(WALLET_A);
    const result = await agentNoncesRepo.getCurrentNonce(WALLET_A);

    expect(result.currentNonce).toBe(5);
  });

  // --- getNextNonce ---

  it.skipIf(!available)('returns the current nonce and increments atomically', async () => {
    await agentNoncesRepo.initializeNonce(WALLET_A, 0);

    const first = await agentNoncesRepo.getNextNonce(WALLET_A);
    expect(first.nonce).toBe(0);
    expect(first.item.currentNonce).toBe(1);

    const second = await agentNoncesRepo.getNextNonce(WALLET_A);
    expect(second.nonce).toBe(1);
    expect(second.item.currentNonce).toBe(2);
  });

  it.skipIf(!available)('increments from a non-zero start', async () => {
    await agentNoncesRepo.initializeNonce(WALLET_A, 100);

    const result = await agentNoncesRepo.getNextNonce(WALLET_A);
    expect(result.nonce).toBe(100);

    const verify = await agentNoncesRepo.getCurrentNonce(WALLET_A);
    expect(verify.currentNonce).toBe(101);
  });

  it.skipIf(!available)('fails for uninitialized wallet', async () => {
    await expect(agentNoncesRepo.getNextNonce(WALLET_A)).rejects.toThrow();
  });

  it.skipIf(!available)('updates lastUsedAt on each increment', async () => {
    await agentNoncesRepo.initializeNonce(WALLET_A, 0);

    const before = await agentNoncesRepo.getCurrentNonce(WALLET_A);
    const t0 = before.lastUsedAt;

    await agentNoncesRepo.getNextNonce(WALLET_A);
    const after = await agentNoncesRepo.getCurrentNonce(WALLET_A);

    expect(after.lastUsedAt >= t0).toBe(true);
  });

  it.skipIf(!available)('concurrent callers get unique sequential nonces', async () => {
    await agentNoncesRepo.initializeNonce(WALLET_A, 0);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => agentNoncesRepo.getNextNonce(WALLET_A)),
    );

    const nonces = results.map((r) => r.nonce).sort((a, b) => a - b);
    expect(nonces).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const final = await agentNoncesRepo.getCurrentNonce(WALLET_A);
    expect(final.currentNonce).toBe(10);
  });

  it.skipIf(!available)('isolates nonces between wallets', async () => {
    await agentNoncesRepo.initializeNonce(WALLET_A, 0);
    await agentNoncesRepo.initializeNonce(WALLET_B, 50);

    await agentNoncesRepo.getNextNonce(WALLET_A);
    await agentNoncesRepo.getNextNonce(WALLET_A);
    await agentNoncesRepo.getNextNonce(WALLET_B);

    const a = await agentNoncesRepo.getCurrentNonce(WALLET_A);
    const b = await agentNoncesRepo.getCurrentNonce(WALLET_B);

    expect(a.currentNonce).toBe(2);
    expect(b.currentNonce).toBe(51);
  });

  // --- full lifecycle ---

  it.skipIf(!available)('init → getNext → getCurrent round-trip', async () => {
    const init = await agentNoncesRepo.initializeNonce(WALLET_A, 0);
    expect(init.currentNonce).toBe(0);

    const next = await agentNoncesRepo.getNextNonce(WALLET_A);
    expect(next.nonce).toBe(0);

    const current = await agentNoncesRepo.getCurrentNonce(WALLET_A);
    expect(current.currentNonce).toBe(1);
  });
});
