import { z } from 'zod';
import { logger } from './logger.js';

const OPTIONAL_ENV_VARS = [
  { path: 'chain.rpcUrl', env: 'CHAIN_RPC_URL', impact: 'on-chain payment verification disabled' },
  {
    path: 'secretArns.stripe',
    env: 'STRIPE_WEBHOOK_SECRET_ARN',
    impact: 'Stripe webhook verification disabled',
  },
  {
    path: 'secretArns.baseRpc',
    env: 'BASE_RPC_SECRET_ARN',
    impact: 'Base RPC secret lookup disabled',
  },
  {
    path: 'secretArns.adminApiKeyHash',
    env: 'ADMIN_API_KEY_HASH_SECRET_ARN',
    impact: 'admin endpoints disabled',
  },
];

const ConfigSchema = z.object({
  awsRegion: z.string().min(1),
  stage: z.enum(['dev', 'staging', 'prod']),
  chain: z.object({
    rpcUrl: z.string().url().optional(),
    chainId: z.number().int().positive(),
    requiredConfirmations: z.number().int().min(1).max(64),
    usdcContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  }),
  x402: z.object({
    paymentWindowSeconds: z.number().int().min(10).max(600),
  }),
  solana: z
    .object({
      network: z.string().min(1),
      payTo: z.string().min(1),
      usdcMint: z.string().min(1),
    })
    .optional(),
  xrpl: z
    .object({
      payTo: z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/),
      usdcIssuer: z
        .string()
        .regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/)
        .optional(),
      rlusdIssuer: z
        .string()
        .regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/)
        .optional(),
    })
    .optional(),
  secretArns: z.object({
    agentWallet: z.string().min(1),
    stripe: z.string().optional(),
    baseRpc: z.string().optional(),
    adminApiKeyHash: z.string().optional(),
  }),
});

let cached;

export function getConfig() {
  if (cached) return cached;
  cached = ConfigSchema.parse({
    awsRegion: process.env.AWS_REGION,
    stage: process.env.STAGE,
    chain: {
      rpcUrl: process.env.CHAIN_RPC_URL,
      chainId: Number(process.env.CHAIN_ID),
      requiredConfirmations: Number(process.env.X402_REQUIRED_CONFIRMATIONS ?? 2),
      usdcContract: process.env.USDC_CONTRACT_ADDRESS,
    },
    x402: {
      paymentWindowSeconds: Number(process.env.X402_PAYMENT_WINDOW_SECONDS ?? 120),
    },
    solana: process.env.SOLANA_PAY_TO
      ? {
          network: process.env.SOLANA_NETWORK ?? 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
          payTo: process.env.SOLANA_PAY_TO,
          usdcMint: process.env.SOLANA_USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        }
      : undefined,
    xrpl: process.env.XRPL_PAY_TO
      ? {
          payTo: process.env.XRPL_PAY_TO,
          usdcIssuer: process.env.XRPL_USDC_ISSUER || undefined,
          rlusdIssuer: process.env.XRPL_RLUSD_ISSUER || undefined,
        }
      : undefined,
    secretArns: {
      agentWallet: process.env.AGENT_WALLET_SECRET_ARN,
      stripe: process.env.STRIPE_WEBHOOK_SECRET_ARN,
      baseRpc: process.env.BASE_RPC_SECRET_ARN,
      adminApiKeyHash: process.env.ADMIN_API_KEY_HASH_SECRET_ARN,
    },
  });
  return cached;
}

function resolve(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

export function selfTest() {
  const cfg = getConfig();
  const missing = OPTIONAL_ENV_VARS.filter((v) => resolve(cfg, v.path) == null);
  if (missing.length === 0) {
    logger.info('config self-test: all optional env vars present');
    return missing;
  }
  for (const v of missing) {
    logger.warn(
      { env: v.env, impact: v.impact },
      `config self-test: ${v.env} not set — ${v.impact}`,
    );
  }
  return missing;
}
