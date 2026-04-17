/* eslint-disable no-restricted-imports */
import { FetchRequest, JsonRpcProvider, Wallet, id as keccak256 } from 'ethers';
import { getConfig } from '../../lib/config.js';
import { getSecret, getSecretJson } from '../../lib/secrets.js';
import { UpstreamError } from '../../lib/errors.js';
import { getAdapterTimeoutMs } from '../../lib/http.js';
import { withRetry } from '../retry.js';
import { CircuitBreaker } from '../circuit-breaker.js';

const TRANSFER_TOPIC = keccak256('Transfer(address,address,uint256)');

let provider;
let signer;

const rpcBreaker = new CircuitBreaker('chain-rpc');

async function getProvider() {
  if (provider) return provider;
  const cfg = getConfig();
  let rpcUrl;
  if (cfg.secretArns.baseRpc) {
    rpcUrl = await getSecret(cfg.secretArns.baseRpc);
  } else if (cfg.chain.rpcUrl) {
    rpcUrl = cfg.chain.rpcUrl;
  } else {
    throw new UpstreamError('chain', {
      reason: 'no-rpc-url',
      message: 'Set BASE_RPC_SECRET_ARN or CHAIN_RPC_URL',
    });
  }
  const req = new FetchRequest(rpcUrl);
  req.timeout = getAdapterTimeoutMs();
  provider = new JsonRpcProvider(req, cfg.chain.chainId);
  return provider;
}

async function getSigner() {
  if (signer) return signer;
  const cfg = getConfig();
  const secret = await getSecretJson(cfg.secretArns.agentWallet);
  signer = new Wallet(secret.privateKey, await getProvider());
  return signer;
}

export async function getAgentAddress() {
  const s = await getSigner();
  return s.address;
}

export async function getTransaction(txHash) {
  return rpcBreaker.fire(() =>
    withRetry(async () => {
      const p = await getProvider();
      const tx = await p.getTransaction(txHash);
      if (!tx) throw new UpstreamError('chain', { reason: 'tx-not-found', txHash });
      return tx;
    }),
  );
}

export async function getTransactionReceipt(txHash) {
  return rpcBreaker.fire(() =>
    withRetry(async () => {
      const p = await getProvider();
      const receipt = await p.getTransactionReceipt(txHash);
      if (!receipt) throw new UpstreamError('chain', { reason: 'receipt-not-found', txHash });
      return receipt;
    }),
  );
}

export async function getConfirmations(txHash) {
  const tx = await getTransaction(txHash);
  return rpcBreaker.fire(() => withRetry(() => tx.confirmations()));
}

/**
 * Find the first ERC-20 Transfer(from, to, amount) log in the receipt
 * that was emitted by the expected USDC contract.
 */
function findUsdcTransfer(receipt, usdcContract) {
  const contractLower = usdcContract.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractLower) continue;
    if (log.topics.length < 3 || log.topics[0] !== TRANSFER_TOPIC) continue;
    const to = '0x' + log.topics[2].slice(26);
    const amount = BigInt(log.data);
    return { to, amount };
  }
  return null;
}

export async function verifyPayment(input) {
  const cfg = getConfig();
  const receipt = await getTransactionReceipt(input.txHash);

  if (!receipt.status) {
    return { ok: false, reason: 'tx-reverted' };
  }

  const transfer = findUsdcTransfer(receipt, cfg.chain.usdcContract);
  if (!transfer) {
    return { ok: false, reason: 'no-usdc-transfer' };
  }

  if (transfer.to.toLowerCase() !== input.expectedTo.toLowerCase()) {
    return { ok: false, reason: 'wrong-recipient' };
  }

  if (transfer.amount < input.expectedAmountWei) {
    return { ok: false, reason: 'amount-too-low' };
  }

  const tx = await getTransaction(input.txHash);
  const confs = await tx.confirmations();
  if (confs < input.minConfirmations) {
    return { ok: false, reason: 'insufficient-confirmations' };
  }

  return { ok: true, blockNumber: receipt.blockNumber ?? undefined };
}

/**
 * Generate a fresh ephemeral receiver wallet (private key discarded). Lives
 * in the adapter so callers don't import ethers directly.
 *
 * @returns {{ address: string }}
 */
export function createRandomReceiver() {
  return { address: Wallet.createRandom().address };
}

/**
 * Send a native EVM transfer (ETH on Base, etc.) from the agent wallet to a
 * fresh recipient. Used by the demo relayer to settle a real on-chain payment
 * the public can watch. Awaits 1 confirmation and returns receipt metadata.
 *
 * @param {{ to: string, valueWei: bigint }} params
 * @returns {Promise<{ hash: string, blockNumber: number, gasUsed: string, from: string, to: string }>}
 */
export async function sendNativeEth({ to, valueWei }) {
  return rpcBreaker.fire(() =>
    withRetry(async () => {
      const s = await getSigner();
      const tx = await s.sendTransaction({ to, value: valueWei });
      const receipt = await tx.wait(1);
      if (!receipt || !receipt.status) {
        throw new UpstreamError('chain', { reason: 'tx-reverted', txHash: tx.hash });
      }
      return {
        hash: tx.hash,
        blockNumber: receipt.blockNumber ?? 0,
        gasUsed: String(receipt.gasUsed ?? '0'),
        from: s.address,
        to,
      };
    }),
  );
}

/** Exposed for testing — reset circuit breaker state between tests. */
export function _resetBreaker() {
  rpcBreaker.reset();
}
