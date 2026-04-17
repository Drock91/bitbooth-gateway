import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { getConfig } from '../lib/config.js';
import { getSecret } from '../lib/secrets.js';

const PAYMENTS_TABLE = process.env.PAYMENTS_TABLE ?? 'x402-payments';

async function checkDdb() {
  const start = Date.now();
  try {
    const client = new DynamoDBClient({ region: getConfig().awsRegion });
    await client.send(new DescribeTableCommand({ TableName: PAYMENTS_TABLE }));
    return { name: 'dynamodb', ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { name: 'dynamodb', ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}

async function checkSecrets() {
  const start = Date.now();
  try {
    const cfg = getConfig();
    await getSecret(cfg.secretArns.agentWallet);
    return { name: 'secrets', ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { name: 'secrets', ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}

async function checkChainRpc() {
  const start = Date.now();
  try {
    const cfg = getConfig();
    let rpcUrl;
    if (cfg.secretArns.baseRpc) {
      rpcUrl = await getSecret(cfg.secretArns.baseRpc);
    } else if (cfg.chain.rpcUrl) {
      rpcUrl = cfg.chain.rpcUrl;
    } else {
      return {
        name: 'chain_rpc',
        ok: false,
        latencyMs: Date.now() - start,
        error: 'no RPC URL configured',
      };
    }
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return {
        name: 'chain_rpc',
        ok: false,
        latencyMs: Date.now() - start,
        error: `HTTP ${res.status}`,
      };
    }
    const body = await res.json();
    if (body.error) {
      return {
        name: 'chain_rpc',
        ok: false,
        latencyMs: Date.now() - start,
        error: body.error.message,
      };
    }
    return { name: 'chain_rpc', ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { name: 'chain_rpc', ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}

export async function checkReady() {
  const checks = await Promise.all([checkDdb(), checkSecrets(), checkChainRpc()]);
  const ok = checks.every((c) => c.ok);
  return { ok, stage: getConfig().stage, checks };
}
