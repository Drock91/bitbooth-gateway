/* eslint-disable no-restricted-imports */
import { createPublicClient, http, keccak256, toHex } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { getConfig } from '../../lib/config.js';
import { getSecret } from '../../lib/secrets.js';
import { UpstreamError } from '../../lib/errors.js';
import { getAdapterTimeoutMs } from '../../lib/http.js';
import { withRetry } from '../retry.js';
import { CircuitBreaker } from '../circuit-breaker.js';

export const BASE_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'));

let client;
const rpcBreaker = new CircuitBreaker('base-rpc');

async function getClient() {
  if (client) return client;
  const cfg = getConfig();
  let rpcUrl;
  if (cfg.secretArns.baseRpc) {
    rpcUrl = await getSecret(cfg.secretArns.baseRpc);
  } else if (cfg.chain.rpcUrl) {
    rpcUrl = cfg.chain.rpcUrl;
  } else {
    throw new UpstreamError('base-chain', {
      reason: 'no-rpc-url',
      message: 'Set BASE_RPC_SECRET_ARN or CHAIN_RPC_URL',
    });
  }
  // Pick the chain config matching cfg.chain.chainId. viem uses `chain` for
  // some block/tx decoding internals; mixing mainnet chain with Sepolia RPC
  // mostly works but is incorrect. Match them.
  const viemChain = cfg.chain.chainId === BASE_SEPOLIA_CHAIN_ID ? baseSepolia : base;
  client = createPublicClient({
    chain: viemChain,
    transport: http(rpcUrl, { timeout: getAdapterTimeoutMs() }),
  });
  return client;
}

export async function getTransactionReceipt(txHash) {
  return rpcBreaker.fire(() =>
    withRetry(async () => {
      const c = await getClient();
      const receipt = await c.getTransactionReceipt({ hash: txHash });
      if (!receipt) throw new UpstreamError('base-chain', { reason: 'receipt-not-found', txHash });
      return receipt;
    }),
  );
}

function findUsdcTransfer(logs, usdcContract) {
  const contractLower = usdcContract.toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== contractLower) continue;
    if (!log.topics || log.topics.length < 3 || log.topics[0] !== TRANSFER_TOPIC) continue;
    const to = '0x' + log.topics[2].slice(26);
    const amount = BigInt(log.data);
    return { to, amount };
  }
  return null;
}

export async function verifyPayment(input) {
  const cfg = getConfig();
  const receipt = await getTransactionReceipt(input.txHash);

  if (receipt.status !== 'success') {
    return { ok: false, reason: 'tx-reverted' };
  }

  // Use the chain-appropriate USDC contract from config (Sepolia vs mainnet),
  // not the hardcoded mainnet BASE_USDC. Without this, Base Sepolia payments
  // never match because the logs contain the Sepolia USDC address.
  const transfer = findUsdcTransfer(receipt.logs, cfg.chain.usdcContract);
  if (!transfer) {
    return { ok: false, reason: 'no-usdc-transfer' };
  }

  if (transfer.to.toLowerCase() !== input.expectedTo.toLowerCase()) {
    return { ok: false, reason: 'wrong-recipient' };
  }

  if (transfer.amount < input.expectedAmountWei) {
    return { ok: false, reason: 'amount-too-low' };
  }

  const c = await getClient();
  const currentBlock = await rpcBreaker.fire(() => withRetry(() => c.getBlockNumber()));
  const confs = Number(currentBlock - receipt.blockNumber);
  if (confs < input.minConfirmations) {
    return { ok: false, reason: 'insufficient-confirmations' };
  }

  return { ok: true, blockNumber: Number(receipt.blockNumber) };
}

export function _resetBreaker() {
  rpcBreaker.reset();
}
