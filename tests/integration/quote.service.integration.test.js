/**
 * Integration test for quote.service.getBest + routing.service.bestQuote.
 *
 * Covers:
 *   - multi-adapter routing with bestQuote selecting the max net = cryptoAmount - feeFiat
 *   - specific-exchange path via getAdapter (input.exchange)
 *   - partial-availability path (only one adapter has a secret)
 *   - all-adapters-failing path (no secrets) → UpstreamError
 *
 * Runs against LocalStack Secrets Manager. DDB is not used by quote.service, but the
 * integration harness is the right place to exercise the real Secrets Manager SDK
 * path that drives every exchange adapter's creds() call.
 */

process.env.SECRET_CACHE_TTL_MS = '1';
process.env.MOONPAY_API_KEY_SECRET_ARN = 'quote-svc-moonpay';
process.env.COINBASE_API_KEY_SECRET_ARN = 'quote-svc-coinbase';
process.env.KRAKEN_API_KEY_SECRET_ARN = 'quote-svc-kraken';
process.env.BINANCE_API_KEY_SECRET_ARN = 'quote-svc-binance';
process.env.UPHOLD_API_KEY_SECRET_ARN = 'quote-svc-uphold';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  SecretsManagerClient,
  CreateSecretCommand,
  DeleteSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import { isLocalStackUp } from './helpers.js';

let available = false;
let quoteService;
let bestQuote;
let UpstreamError;

const endpoint = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const region = process.env.AWS_REGION ?? 'us-east-1';

const smClient = new SecretsManagerClient({
  region,
  endpoint,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

const EXCHANGES = ['moonpay', 'coinbase', 'kraken', 'binance', 'uphold'];
const SECRET_NAMES = Object.fromEntries(EXCHANGES.map((e) => [e, `quote-svc-${e}`]));

async function ensureSecret(name, payload) {
  try {
    await smClient.send(
      new CreateSecretCommand({
        Name: name,
        SecretString: JSON.stringify(payload),
      }),
    );
  } catch (e) {
    if (e.name !== 'ResourceExistsException') throw e;
  }
}

async function removeSecret(name) {
  try {
    await smClient.send(
      new DeleteSecretCommand({
        SecretId: name,
        ForceDeleteWithoutRecovery: true,
      }),
    );
  } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
  }
}

async function ensureAllSecrets() {
  for (const ex of EXCHANGES) {
    await ensureSecret(SECRET_NAMES[ex], { secretKey: `${ex}-key`, webhookSecret: `${ex}-wh` });
  }
}

async function removeAllSecrets() {
  for (const ex of EXCHANGES) {
    await removeSecret(SECRET_NAMES[ex]);
  }
}

async function waitForCacheExpiry() {
  await new Promise((r) => setTimeout(r, 10));
}

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;

  const svc = await import('../../src/services/quote.service.js');
  const routing = await import('../../src/services/routing.service.js');
  const errs = await import('../../src/lib/errors.js');
  quoteService = svc.quoteService;
  bestQuote = routing.bestQuote;
  UpstreamError = errs.UpstreamError;
});

afterAll(async () => {
  if (!available) return;
  await removeAllSecrets();
});

describe('quote.service.getBest integration', () => {
  beforeEach(async () => {
    if (!available) return;
    await removeAllSecrets();
    await waitForCacheExpiry();
  });

  // --- multi-adapter routing (bestQuote) ---

  it.skipIf(!available)(
    'selects the exchange with the max net (cryptoAmount - feeFiat)',
    async () => {
      await ensureAllSecrets();

      const result = await quoteService.getBest({
        fiatCurrency: 'USD',
        fiatAmount: 100,
        cryptoAsset: 'USDC',
      });

      // Hardcoded pricing (see adapter clients):
      //   moonpay:  0.9995 *100 - 1.49  = 98.46
      //   coinbase: 0.999  *100 - 0.99  = 98.91
      //   kraken:   0.9992 *100 - 0.26  = 99.66
      //   binance:  0.9993 *100 - 0.10  = 99.83   ← winner
      //   uphold:   0.9985 *100 - 1.50  = 98.35
      expect(result.exchange).toBe('binance');
      expect(result.cryptoAsset).toBe('USDC');
      expect(result.fiatCurrency).toBe('USD');
      expect(result.fiatAmount).toBe(100);
      expect(result.feeFiat).toBeCloseTo(0.1, 6);
      expect(Number(result.cryptoAmount)).toBeCloseTo(99.93, 6);
    },
  );

  it.skipIf(!available)('scales winner selection across fiat amounts', async () => {
    await ensureAllSecrets();

    const result = await quoteService.getBest({
      fiatCurrency: 'USD',
      fiatAmount: 1000,
      cryptoAsset: 'USDC',
    });

    expect(result.exchange).toBe('binance');
    expect(result.fiatAmount).toBe(1000);
    expect(Number(result.cryptoAmount)).toBeCloseTo(999.3, 6);
  });

  it.skipIf(!available)('returns a valid quote shape from bestQuote directly', async () => {
    await ensureAllSecrets();

    const result = await bestQuote({
      fiatCurrency: 'USD',
      fiatAmount: 250,
      cryptoAsset: 'USDC',
    });

    expect(result).toHaveProperty('exchange');
    expect(result).toHaveProperty('quoteId');
    expect(result).toHaveProperty('expiresAt');
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  // --- specific-exchange path (getAdapter) ---

  it.skipIf(!available)('routes to the requested exchange when input.exchange is set', async () => {
    await ensureAllSecrets();

    const result = await quoteService.getBest({
      exchange: 'moonpay',
      fiatCurrency: 'EUR',
      fiatAmount: 200,
      cryptoAsset: 'USDC',
    });

    expect(result.exchange).toBe('moonpay');
    expect(result.fiatCurrency).toBe('EUR');
    expect(result.fiatAmount).toBe(200);
    expect(result.quoteId).toMatch(/^mp_/);
  });

  it.skipIf(!available)(
    'surfaces adapter-level UpstreamError when the requested exchange has no secret',
    async () => {
      await ensureSecret(SECRET_NAMES.moonpay, { secretKey: 'k', webhookSecret: 'w' });
      // kraken secret not created

      await expect(
        quoteService.getBest({
          exchange: 'kraken',
          fiatCurrency: 'USD',
          fiatAmount: 100,
          cryptoAsset: 'USDC',
        }),
      ).rejects.toThrow();
    },
  );

  // --- partial availability ---

  it.skipIf(!available)(
    'bestQuote returns the single surviving adapter when 4 of 5 fail',
    async () => {
      await ensureSecret(SECRET_NAMES.kraken, { secretKey: 'k', webhookSecret: 'w' });
      await waitForCacheExpiry();

      const result = await quoteService.getBest({
        fiatCurrency: 'USD',
        fiatAmount: 100,
        cryptoAsset: 'USDC',
      });

      expect(result.exchange).toBe('kraken');
      expect(Number(result.cryptoAmount)).toBeCloseTo(99.92, 6);
    },
  );

  it.skipIf(!available)(
    'bestQuote returns the only funded exchange even when it is not the cheapest-rated',
    async () => {
      await ensureSecret(SECRET_NAMES.uphold, { secretKey: 'k', webhookSecret: 'w' });
      await waitForCacheExpiry();

      const result = await quoteService.getBest({
        fiatCurrency: 'USD',
        fiatAmount: 100,
        cryptoAsset: 'USDC',
      });

      // uphold has the worst net in multi-adapter mode, but wins as the sole survivor.
      expect(result.exchange).toBe('uphold');
    },
  );

  // --- all-adapters-failing path ---

  it.skipIf(!available)('bestQuote throws UpstreamError when every adapter fails', async () => {
    await waitForCacheExpiry();

    let caught;
    try {
      await quoteService.getBest({
        fiatCurrency: 'USD',
        fiatAmount: 100,
        cryptoAsset: 'USDC',
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(UpstreamError);
    expect(caught.message).toMatch(/upstream exchange/i);
    expect(caught.details.reason).toMatch(/no exchange/i);
  });

  it.skipIf(!available)(
    'bestQuote surfaces UpstreamError when called directly with all secrets missing',
    async () => {
      await waitForCacheExpiry();

      await expect(
        bestQuote({
          fiatCurrency: 'USD',
          fiatAmount: 100,
          cryptoAsset: 'USDC',
        }),
      ).rejects.toBeInstanceOf(UpstreamError);
    },
  );

  // --- cache / determinism sanity ---

  it.skipIf(!available)('each call issues a distinct quoteId (no stale cache)', async () => {
    await ensureAllSecrets();

    const a = await quoteService.getBest({
      fiatCurrency: 'USD',
      fiatAmount: 100,
      cryptoAsset: 'USDC',
    });
    await new Promise((r) => setTimeout(r, 2));
    const b = await quoteService.getBest({
      fiatCurrency: 'USD',
      fiatAmount: 100,
      cryptoAsset: 'USDC',
    });

    expect(a.exchange).toBe('binance');
    expect(b.exchange).toBe('binance');
    expect(a.quoteId).not.toBe(b.quoteId);
  });
});
