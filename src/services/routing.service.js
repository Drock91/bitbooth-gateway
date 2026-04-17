import { moonpayAdapter } from '../adapters/moonpay/index.js';
import { coinbaseAdapter } from '../adapters/coinbase/index.js';
import { krakenAdapter } from '../adapters/kraken/index.js';
import { binanceAdapter } from '../adapters/binance/index.js';
import { upholdAdapter } from '../adapters/uphold/index.js';
import { verifyPayment as xrplEvmVerify } from '../adapters/xrpl-evm/index.js';
import {
  verifyPayment as baseVerify,
  BASE_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
} from '../adapters/base/index.js';
import { verifyPayment as nativeXrplVerify } from '../adapters/xrpl/index.js';
import { verifyPayment as solanaVerify } from '../adapters/solana/index.js';
import { getConfig } from '../lib/config.js';
import { UpstreamError } from '../lib/errors.js';

export const SOLANA_MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const SOLANA_DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

const registry = {
  moonpay: moonpayAdapter,
  coinbase: coinbaseAdapter,
  kraken: krakenAdapter,
  binance: binanceAdapter,
  uphold: upholdAdapter,
};

function formatIouValue(amountBaseUnits) {
  const decimals = 6;
  const divisor = BigInt(10 ** decimals);
  const whole = amountBaseUnits / divisor;
  const frac = amountBaseUnits % divisor;
  return frac > 0n ? `${whole}.${String(frac).padStart(decimals, '0')}` : `${whole}`;
}

function wrapXrplVerify(input) {
  const txHash = input.txHash.startsWith('0x') ? input.txHash.slice(2) : input.txHash;
  const amountBaseUnits = input.expectedAmountWei;
  const value = formatIouValue(amountBaseUnits);

  let cfg;
  try {
    cfg = getConfig();
  } catch {
    cfg = undefined;
  }

  if (input.issuer) {
    if (cfg?.xrpl?.usdcIssuer && input.issuer === cfg.xrpl.usdcIssuer) {
      return nativeXrplVerify({
        txHash,
        destination: input.expectedTo,
        amount: { currency: 'USD', issuer: input.issuer, value },
        issuer: input.issuer,
      });
    }
    if (cfg?.xrpl?.rlusdIssuer && input.issuer === cfg.xrpl.rlusdIssuer) {
      return nativeXrplVerify({
        txHash,
        destination: input.expectedTo,
        amount: { currency: 'RLUSD', issuer: input.issuer, value },
        issuer: input.issuer,
      });
    }
    return { ok: false, reason: 'forged-issuer' };
  }

  const allowed = [];
  if (cfg?.xrpl?.usdcIssuer) {
    allowed.push({ currency: 'USD', issuer: cfg.xrpl.usdcIssuer, value });
  }
  if (cfg?.xrpl?.rlusdIssuer) {
    allowed.push({ currency: 'RLUSD', issuer: cfg.xrpl.rlusdIssuer, value });
  }

  if (allowed.length > 0) {
    return nativeXrplVerify({
      txHash,
      destination: input.expectedTo,
      allowed,
    });
  }

  return nativeXrplVerify({
    txHash,
    destination: input.expectedTo,
    amount: String(amountBaseUnits),
    issuer: undefined,
  });
}

/** @type {Record<string, import('../adapters/types.js').ChainAdapter>} */
const chainRouter = {
  'eip155:1440002': {
    name: 'xrpl-evm',
    caip2: 'eip155:1440002',
    verifyPayment: xrplEvmVerify,
  },
  [`eip155:${BASE_CHAIN_ID}`]: {
    name: 'base',
    caip2: `eip155:${BASE_CHAIN_ID}`,
    verifyPayment: baseVerify,
  },
  // Base Sepolia (staging default). Same adapter + RPC (configured per env),
  // different chainId. Registered so the x402 middleware on staging can
  // route eip155:84532 payments via the base adapter.
  [`eip155:${BASE_SEPOLIA_CHAIN_ID}`]: {
    name: 'base-sepolia',
    caip2: `eip155:${BASE_SEPOLIA_CHAIN_ID}`,
    verifyPayment: baseVerify,
  },
  'xrpl:0': {
    name: 'xrpl-mainnet',
    caip2: 'xrpl:0',
    verifyPayment: wrapXrplVerify,
  },
  'xrpl:1': {
    name: 'xrpl-testnet',
    caip2: 'xrpl:1',
    verifyPayment: wrapXrplVerify,
  },
  [SOLANA_MAINNET_CAIP2]: {
    name: 'solana-mainnet',
    caip2: SOLANA_MAINNET_CAIP2,
    verifyPayment: solanaVerify,
  },
  [SOLANA_DEVNET_CAIP2]: {
    name: 'solana-devnet',
    caip2: SOLANA_DEVNET_CAIP2,
    verifyPayment: solanaVerify,
  },
};

export function getAdapter(name) {
  return registry[name];
}

export function getChainAdapter(network) {
  return chainRouter[network];
}

export function listChainNetworks() {
  return Object.keys(chainRouter);
}

export async function bestQuote(input) {
  const quotes = await Promise.allSettled(Object.values(registry).map((a) => a.quote(input)));
  const valid = quotes.filter((q) => q.status === 'fulfilled').map((q) => q.value);
  if (valid.length === 0)
    throw new UpstreamError('exchange', { reason: 'no exchange returned a quote' });
  return valid.reduce((best, q) =>
    Number(q.cryptoAmount) - q.feeFiat > Number(best.cryptoAmount) - best.feeFiat ? q : best,
  );
}
