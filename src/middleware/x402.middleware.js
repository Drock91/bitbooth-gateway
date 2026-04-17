import { PaymentRequiredError, ValidationError } from '../lib/errors.js';
import { newNonce } from '../lib/crypto.js';
import { getConfig } from '../lib/config.js';
import { getAgentAddress } from '../adapters/xrpl-evm/index.js';
import { getChainAdapter } from '../services/routing.service.js';
import { PaymentHeader } from '../validators/payment.schema.js';
import { paymentsRepo } from '../repositories/payments.repo.js';
import { usageRepo } from '../repositories/usage.repo.js';
import { fraudService } from '../services/fraud.service.js';
import { paymentVerified, paymentFailed } from '../lib/metrics.js';

export async function enforceX402(input) {
  const cfg = getConfig();
  const payTo = await getAgentAddress();

  const raw = input.headers['x-payment'] ?? input.headers['X-PAYMENT'];
  if (!raw) {
    throw new PaymentRequiredError(buildChallenge(input.route, payTo));
  }

  let parsed;
  try {
    parsed = PaymentHeader.parse(JSON.parse(raw));
  } catch (e) {
    throw new ValidationError({ header: 'X-PAYMENT', issue: e.message });
  }

  const seen = await paymentsRepo.getByNonce(parsed.nonce);
  if (seen) {
    await fraudService.trackNonceFailure(input.accountId, input.route.fraudRules);
    paymentFailed({
      accountId: input.accountId,
      route: input.route.resource,
      reason: 'nonce_reuse',
    });
    throw new PaymentRequiredError(buildChallenge(input.route, payTo));
  }

  await fraudService.checkPrePayment({
    accountId: input.accountId,
    amountWei: input.route.amountWei,
    fraudRules: input.route.fraudRules,
  });

  const network = parsed.network ?? `eip155:${cfg.chain.chainId}`;
  const result = await verifyByNetwork(network, parsed, input, payTo, cfg);

  if (!result.ok) {
    paymentFailed({
      accountId: input.accountId,
      route: input.route.resource,
      reason: result.reason,
    });
    throw new PaymentRequiredError({
      ...buildChallenge(input.route, payTo),
      reason: result.reason,
    });
  }

  await paymentsRepo.recordConfirmed({
    idempotencyKey: parsed.nonce,
    accountId: input.accountId,
    amountWei: input.route.amountWei,
    assetSymbol: input.route.assetSymbol,
    txHash: parsed.txHash,
    blockNumber: result.blockNumber,
    resource: input.route.resource,
  });

  await usageRepo.increment(input.accountId, {
    resource: input.route.resource,
    txHash: parsed.txHash,
  });

  paymentVerified({ accountId: input.accountId, route: input.route.resource });

  return { paid: true, txHash: parsed.txHash };
}

export function resolvePayToForNetwork(network, cfg, evmPayTo) {
  if (typeof network !== 'string') return null;
  if (network.startsWith('eip155:')) return evmPayTo ?? null;
  if (network.startsWith('solana:')) return cfg.solana?.payTo ?? null;
  if (network.startsWith('xrpl:')) return cfg.xrpl?.payTo ?? null;
  return null;
}

function verifyByNetwork(network, parsed, input, evmPayTo, cfg) {
  const adapter = getChainAdapter(network);
  if (!adapter) {
    return { ok: false, reason: 'unsupported-network' };
  }

  const expectedTo = resolvePayToForNetwork(network, cfg, evmPayTo);
  if (!expectedTo) {
    return { ok: false, reason: 'missing-payto' };
  }

  return adapter.verifyPayment({
    txHash: parsed.txHash,
    expectedTo,
    expectedAmountWei: BigInt(input.route.amountWei),
    minConfirmations: cfg.chain.requiredConfirmations,
  });
}

function buildChallenge(route, payTo) {
  const cfg = getConfig();
  const nonce = newNonce();
  const expiresAt = Math.floor(Date.now() / 1000) + cfg.x402.paymentWindowSeconds;

  const accepts = [
    {
      scheme: 'exact',
      network: `eip155:${cfg.chain.chainId}`,
      payTo,
      asset: `${route.assetSymbol}@${cfg.chain.usdcContract}`,
      amount: route.amountWei,
    },
  ];

  if (cfg.solana) {
    accepts.push({
      scheme: 'exact',
      network: cfg.solana.network,
      payTo: cfg.solana.payTo,
      asset: `${route.assetSymbol}@${cfg.solana.usdcMint}`,
      amount: route.amountWei,
    });
  }

  if (cfg.xrpl) {
    const network = cfg.stage === 'prod' ? 'xrpl:0' : 'xrpl:1';
    accepts.push({
      scheme: 'exact',
      network,
      payTo: cfg.xrpl.payTo,
      asset: 'XRP',
      amount: route.amountWei,
    });
    if (cfg.xrpl.usdcIssuer) {
      accepts.push({
        scheme: 'exact',
        network,
        payTo: cfg.xrpl.payTo,
        asset: `USDC@${cfg.xrpl.usdcIssuer}`,
        amount: route.amountWei,
      });
    }
    if (cfg.xrpl.rlusdIssuer) {
      accepts.push({
        scheme: 'exact',
        network,
        payTo: cfg.xrpl.payTo,
        asset: `RLUSD@${cfg.xrpl.rlusdIssuer}`,
        amount: route.amountWei,
      });
    }
  }

  return {
    nonce,
    expiresAt,
    resource: route.resource,
    accepts,
    amountWei: route.amountWei,
    assetSymbol: route.assetSymbol,
    payTo,
    chainId: cfg.chain.chainId,
  };
}
