process.env.SECRET_CACHE_TTL_MS = '1';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';
import {
  SecretsManagerClient,
  CreateSecretCommand,
  DeleteSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import { isLocalStackUp, createTable, destroyTable } from './helpers.js';

let available = false;
let checkReady;
let rpcServer;
let rpcPort;
let rpcResponse;

const endpoint = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const region = process.env.AWS_REGION ?? 'us-east-1';

const smClient = new SecretsManagerClient({
  region,
  endpoint,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

const SECRET_NAME = 'agent-wallet';

async function ensureSecret() {
  try {
    await smClient.send(
      new CreateSecretCommand({
        Name: SECRET_NAME,
        SecretString: JSON.stringify({ privateKey: '0xdeadbeef' }),
      }),
    );
  } catch (e) {
    if (e.name === 'ResourceExistsException') return;
    throw e;
  }
}

async function removeSecret() {
  try {
    await smClient.send(
      new DeleteSecretCommand({
        SecretId: SECRET_NAME,
        ForceDeleteWithoutRecovery: true,
      }),
    );
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') return;
    throw e;
  }
}

function setHealthyRpc() {
  rpcResponse = { status: 200, body: { jsonrpc: '2.0', result: '0x1a2b3c', id: 1 } };
}

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;

  rpcServer = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      if (rpcResponse === 'RESET') {
        req.socket.destroy();
        return;
      }
      const { status, body: respBody } = rpcResponse ?? {
        status: 200,
        body: { jsonrpc: '2.0', result: '0x1', id: 1 },
      };
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(respBody));
    });
  });
  await new Promise((resolve) => rpcServer.listen(0, resolve));
  rpcPort = rpcServer.address().port;

  process.env.CHAIN_RPC_URL = `http://127.0.0.1:${rpcPort}`;
  delete process.env.BASE_RPC_SECRET_ARN;

  await createTable('payments');
  await ensureSecret();

  const mod = await import('../../src/services/health.service.js');
  checkReady = mod.checkReady;
});

afterAll(async () => {
  if (rpcServer) rpcServer.close();
  if (!available) return;
  await destroyTable('payments');
  await removeSecret();
});

beforeEach(() => {
  if (!available) return;
  setHealthyRpc();
});

describe('health.service.checkReady integration', () => {
  it.skipIf(!available)('returns ok:true when all probes pass', async () => {
    await createTable('payments');
    await ensureSecret();

    const result = await checkReady();

    expect(result.ok).toBe(true);
    expect(result.stage).toBe('dev');
    expect(result.checks).toHaveLength(3);
    for (const check of result.checks) {
      expect(check.ok).toBe(true);
      expect(check.latencyMs).toBeGreaterThanOrEqual(0);
      expect(check.error).toBeUndefined();
    }
  });

  it.skipIf(!available)('check names are dynamodb, secrets, chain_rpc', async () => {
    const result = await checkReady();
    const names = result.checks.map((c) => c.name).sort();
    expect(names).toEqual(['chain_rpc', 'dynamodb', 'secrets']);
  });

  it.skipIf(!available)('reports dynamodb failure when table is missing', async () => {
    await destroyTable('payments');

    const result = await checkReady();

    const ddbCheck = result.checks.find((c) => c.name === 'dynamodb');
    expect(ddbCheck.ok).toBe(false);
    expect(ddbCheck.error).toBeTruthy();
    expect(ddbCheck.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.ok).toBe(false);

    await createTable('payments');
  });

  it.skipIf(!available)('reports secrets failure when secret is missing', async () => {
    await removeSecret();
    await new Promise((r) => setTimeout(r, 5));

    const result = await checkReady();

    const secretCheck = result.checks.find((c) => c.name === 'secrets');
    expect(secretCheck.ok).toBe(false);
    expect(secretCheck.error).toBeTruthy();
    expect(secretCheck.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.ok).toBe(false);

    await ensureSecret();
  });

  it.skipIf(!available)('reports chain_rpc failure on HTTP 500', async () => {
    rpcResponse = { status: 500, body: { error: 'Internal Server Error' } };

    const result = await checkReady();

    const rpcCheck = result.checks.find((c) => c.name === 'chain_rpc');
    expect(rpcCheck.ok).toBe(false);
    expect(rpcCheck.error).toBe('HTTP 500');
    expect(result.ok).toBe(false);
  });

  it.skipIf(!available)('reports chain_rpc failure on JSON-RPC error', async () => {
    rpcResponse = {
      status: 200,
      body: { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid request' }, id: 1 },
    };

    const result = await checkReady();

    const rpcCheck = result.checks.find((c) => c.name === 'chain_rpc');
    expect(rpcCheck.ok).toBe(false);
    expect(rpcCheck.error).toBe('Invalid request');
  });

  it.skipIf(!available)('reports chain_rpc failure on connection reset', async () => {
    rpcResponse = 'RESET';

    const result = await checkReady();

    const rpcCheck = result.checks.find((c) => c.name === 'chain_rpc');
    expect(rpcCheck.ok).toBe(false);
    expect(rpcCheck.error).toBeTruthy();
  });

  it.skipIf(!available)('returns ok:false when only RPC fails', async () => {
    rpcResponse = { status: 502, body: {} };

    const result = await checkReady();

    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === 'dynamodb').ok).toBe(true);
    expect(result.checks.find((c) => c.name === 'secrets').ok).toBe(true);
    expect(result.checks.find((c) => c.name === 'chain_rpc').ok).toBe(false);
  });

  it.skipIf(!available)('returns ok:false when all checks fail', async () => {
    await destroyTable('payments');
    await removeSecret();
    await new Promise((r) => setTimeout(r, 5));
    rpcResponse = { status: 503, body: {} };

    const result = await checkReady();

    expect(result.ok).toBe(false);
    for (const check of result.checks) {
      expect(check.ok).toBe(false);
      expect(check.error).toBeTruthy();
    }

    await createTable('payments');
    await ensureSecret();
  });

  it.skipIf(!available)('recovers after DDB table is recreated', async () => {
    await destroyTable('payments');

    let result = await checkReady();
    expect(result.checks.find((c) => c.name === 'dynamodb').ok).toBe(false);

    await createTable('payments');

    result = await checkReady();
    expect(result.checks.find((c) => c.name === 'dynamodb').ok).toBe(true);
  });

  it.skipIf(!available)('handles concurrent checkReady calls', async () => {
    const results = await Promise.all([checkReady(), checkReady(), checkReady()]);

    for (const result of results) {
      expect(result.ok).toBe(true);
      expect(result.checks).toHaveLength(3);
    }
  });

  it.skipIf(!available)('all checks include finite non-negative latencyMs', async () => {
    const result = await checkReady();

    for (const check of result.checks) {
      expect(check).toHaveProperty('latencyMs');
      expect(check.latencyMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(check.latencyMs)).toBe(true);
    }
  });

  it.skipIf(!available)('includes correct stage from config', async () => {
    const result = await checkReady();
    expect(result.stage).toBe('dev');
  });
});
