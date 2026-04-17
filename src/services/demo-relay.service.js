import {
  getAgentAddress,
  sendNativeEth,
  createRandomReceiver,
} from '../adapters/xrpl-evm/index.js';
import { rateLimitRepo } from '../repositories/rate-limit.repo.js';
import { TooManyRequestsError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { getConfig } from '../lib/config.js';

// Per-IP token bucket: 3 burst, refill 1 every 10s. Loose enough that a human
// clicking Race a few times in a row works; tight enough that a script can't
// drain the wallet (~13 demos at 0.0003 ETH, ~3 min to deplete even at full
// rate). Refund the wallet from any Base Sepolia faucet if drained.
const DEMO_RATE_CAPACITY = 3;
const DEMO_RATE_REFILL_PER_SEC = 1 / 10;

// Tiny transfer amount: 1 wei. Gas is the dominant cost on Base Sepolia
// (~21,000 * gasPrice). Keeping value at 1 wei maximises demos per refill.
const DEMO_VALUE_WEI = 1n;

const EXPLORER_BASE = {
  84532: 'https://sepolia.basescan.org',
  8453: 'https://basescan.org',
};

/**
 * Run a single live demo relay: generate an ephemeral receiver, send a 1-wei
 * transfer from the agent wallet to it on the configured chain, return the
 * receipt + an explorer URL for the public to verify.
 *
 * @param {{ sourceIp: string }} ctx
 * @returns {Promise<{ chain: string, chainId: number, hash: string, blockNumber: number,
 *   gasUsed: string, from: string, to: string, valueWei: string, explorerUrl: string,
 *   receiverAddr: string }>}
 */
export async function runDemoRelay(ctx) {
  const cfg = getConfig();
  const ipKey = `demo-relay:${ctx.sourceIp || 'unknown'}`;

  // Per-IP rate limit. 429 if the IP burned its single token in the last minute.
  const result = await rateLimitRepo.consume(ipKey, DEMO_RATE_CAPACITY, DEMO_RATE_REFILL_PER_SEC);
  if (!result) {
    throw new TooManyRequestsError(60, DEMO_RATE_CAPACITY);
  }

  // Fresh ephemeral receiver per call. Anyone watching can verify the tx
  // really transferred to a brand-new address.
  const receiver = createRandomReceiver();

  logger.info({ ip: ctx.sourceIp, receiver: receiver.address }, 'demo-relay: submitting');

  const receipt = await sendNativeEth({ to: receiver.address, valueWei: DEMO_VALUE_WEI });
  const agentAddr = await getAgentAddress();

  const explorerBase = EXPLORER_BASE[cfg.chain.chainId] || 'https://basescan.org';

  return {
    chain:
      cfg.chain.chainId === 84532
        ? 'Base Sepolia'
        : cfg.chain.chainId === 8453
          ? 'Base'
          : `EVM ${cfg.chain.chainId}`,
    chainId: cfg.chain.chainId,
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    from: agentAddr,
    to: receiver.address,
    receiverAddr: receiver.address,
    valueWei: String(DEMO_VALUE_WEI),
    explorerUrl: `${explorerBase}/tx/${receipt.hash}`,
  };
}
