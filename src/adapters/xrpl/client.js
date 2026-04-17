/* eslint-disable no-restricted-imports */
import { Client } from 'xrpl';
import { UpstreamError } from '../../lib/errors.js';
import { withRetry } from '../retry.js';
import { CircuitBreaker } from '../circuit-breaker.js';
import { TxResult } from './schemas.js';

export const MAINNET_WS = 'wss://xrplcluster.com';
export const TESTNET_WS = 'wss://s.altnet.rippletest.net:51233';

let wsClient;
const rpcBreaker = new CircuitBreaker('native-xrpl');

export function getWsUrl() {
  if (process.env.XRPL_WS_URL) return process.env.XRPL_WS_URL;
  const stage = process.env.STAGE || 'dev';
  return stage === 'prod' ? MAINNET_WS : TESTNET_WS;
}

export async function getClient() {
  if (wsClient?.isConnected()) return wsClient;
  const url = getWsUrl();
  const timeout = Number(process.env.ADAPTER_HTTP_TIMEOUT_MS || 10_000);
  wsClient = new Client(url, { connectionTimeout: timeout });
  await wsClient.connect();
  return wsClient;
}

export async function getTransaction(txHash) {
  return rpcBreaker.fire(() =>
    withRetry(async () => {
      const client = await getClient();
      const response = await client.request({
        command: 'tx',
        transaction: txHash,
      });
      if (!response?.result) {
        throw new UpstreamError('native-xrpl', { reason: 'tx-not-found', txHash });
      }
      return response.result;
    }),
  );
}

function amountsMatch(delivered, expected, issuer) {
  if (typeof delivered === 'string' && typeof expected === 'string') {
    return BigInt(delivered) >= BigInt(expected);
  }
  if (typeof delivered === 'object' && typeof expected === 'object') {
    if (delivered.currency !== expected.currency) return false;
    const expectedIssuer = issuer || expected.issuer;
    if (delivered.issuer !== expectedIssuer) return false;
    return parseFloat(delivered.value) >= parseFloat(expected.value);
  }
  return false;
}

export async function verifyPayment({ txHash, destination, amount, issuer, allowed }) {
  const raw = await getTransaction(txHash);
  const parsed = TxResult.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid-tx-shape' };
  }
  const tx = parsed.data;

  if (tx.TransactionType !== 'Payment') {
    return { ok: false, reason: 'not-a-payment' };
  }

  if (tx.validated !== true) {
    return { ok: false, reason: 'not-validated' };
  }

  if (tx.meta.TransactionResult !== 'tesSUCCESS') {
    return { ok: false, reason: 'tx-failed' };
  }

  if (tx.Destination !== destination) {
    return { ok: false, reason: 'wrong-destination' };
  }

  const delivered = tx.meta.delivered_amount;
  if (!delivered) {
    return { ok: false, reason: 'no-delivered-amount' };
  }

  if (Array.isArray(allowed) && allowed.length > 0) {
    const matched = allowed.some((spec) => amountsMatch(delivered, spec, spec.issuer));
    if (!matched) {
      return { ok: false, reason: 'amount-mismatch' };
    }
  } else if (!amountsMatch(delivered, amount, issuer)) {
    return { ok: false, reason: 'amount-mismatch' };
  }

  return { ok: true, ledgerIndex: tx.ledger_index };
}

export function _resetClient() {
  if (wsClient?.isConnected()) {
    wsClient.disconnect();
  }
  wsClient = null;
}

export function _resetBreaker() {
  rpcBreaker.reset();
}
