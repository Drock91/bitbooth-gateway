/* eslint-disable no-restricted-imports */
import { Connection } from '@solana/web3.js';
import { UpstreamError } from '../../lib/errors.js';
import { withRetry } from '../retry.js';
import { CircuitBreaker } from '../circuit-breaker.js';
import { SolanaTx } from './schemas.js';

export const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDC_DEVNET_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const DEFAULT_MIN_CONFIRMATION_SLOTS = 15;

let connection;
const rpcBreaker = new CircuitBreaker('solana');

export function getRpcUrl() {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  const stage = process.env.STAGE || 'dev';
  return stage === 'prod' ? MAINNET_RPC : DEVNET_RPC;
}

export function getUsdcMint() {
  if (process.env.SOLANA_USDC_MINT) return process.env.SOLANA_USDC_MINT;
  const stage = process.env.STAGE || 'dev';
  return stage === 'prod' ? USDC_MAINNET_MINT : USDC_DEVNET_MINT;
}

export function getConnection() {
  if (connection) return connection;
  connection = new Connection(getRpcUrl(), 'confirmed');
  return connection;
}

export async function getTransaction(txHash) {
  return rpcBreaker.fire(() =>
    withRetry(async () => {
      const conn = getConnection();
      const tx = await conn.getTransaction(txHash, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
      if (!tx) {
        throw new UpstreamError('solana', { reason: 'tx-not-found', txHash });
      }
      return tx;
    }),
  );
}

export async function getSlot() {
  return rpcBreaker.fire(() => withRetry(() => getConnection().getSlot('confirmed')));
}

function findUsdcDelta(tx, owner, mint) {
  const pre = tx.meta.preTokenBalances ?? [];
  const post = tx.meta.postTokenBalances ?? [];
  const postMatch = post.find((b) => b.owner === owner && b.mint === mint);
  if (!postMatch) return null;
  const preMatch = pre.find((b) => b.accountIndex === postMatch.accountIndex && b.mint === mint);
  const preAmt = preMatch ? BigInt(preMatch.uiTokenAmount.amount) : 0n;
  const postAmt = BigInt(postMatch.uiTokenAmount.amount);
  return postAmt - preAmt;
}

/**
 * Verify a Solana SPL USDC payment to `expectedTo`.
 *
 * @param {{txHash:string, expectedTo:string, expectedAmountWei:bigint, minConfirmations?:number}} input
 * @returns {Promise<{ok:true, blockNumber:number} | {ok:false, reason:string}>}
 */
export async function verifyPayment({ txHash, expectedTo, expectedAmountWei, minConfirmations }) {
  const raw = await getTransaction(txHash);
  const parsed = SolanaTx.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid-tx-shape' };
  }
  const tx = parsed.data;

  if (tx.meta.err !== null) {
    return { ok: false, reason: 'tx-failed' };
  }

  const mint = getUsdcMint();
  const delta = findUsdcDelta(tx, expectedTo, mint);
  if (delta === null) {
    return { ok: false, reason: 'no-usdc-transfer-to-destination' };
  }

  const expected = BigInt(expectedAmountWei);
  if (delta < expected) {
    return { ok: false, reason: 'amount-mismatch' };
  }

  const requiredDepth = Number(
    process.env.SOLANA_MIN_CONFIRMATION_SLOTS ?? minConfirmations ?? DEFAULT_MIN_CONFIRMATION_SLOTS,
  );
  const currentSlot = await getSlot();
  if (currentSlot - tx.slot < requiredDepth) {
    return { ok: false, reason: 'insufficient-confirmations' };
  }

  return { ok: true, blockNumber: tx.slot };
}

export function _resetConnection() {
  connection = null;
}

export function _resetBreaker() {
  rpcBreaker.reset();
}
