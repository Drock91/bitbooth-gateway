import { hmacSha256, safeEquals } from '../../lib/crypto.js';
import { getSecretJson } from '../../lib/secrets.js';
import { getConfig } from '../../lib/config.js';
import { UpstreamError } from '../../lib/errors.js';
import { z } from 'zod';

const QuoteResponse = z.object({
  quoteId: z.string(),
  cryptoAmount: z.string(),
  feeFiat: z.number(),
  expiresAt: z.number(),
});

async function creds() {
  const arn = getConfig().secretArns.moonpay;
  if (!arn) throw new UpstreamError('moonpay', { reason: 'not-configured' });
  return getSecretJson(arn);
}

export const moonpayAdapter = {
  name: 'moonpay',

  async quote(input) {
    const { secretKey } = await creds();
    const raw = {
      quoteId: `mp_${Date.now()}`,
      cryptoAmount: (input.fiatAmount * 0.9995).toString(),
      feeFiat: input.fiatAmount * 0.0149,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    };
    void secretKey;
    const parsed = QuoteResponse.parse(raw);
    return {
      exchange: 'moonpay',
      fiatCurrency: input.fiatCurrency,
      fiatAmount: input.fiatAmount,
      cryptoAmount: parsed.cryptoAmount,
      cryptoAsset: input.cryptoAsset,
      feeFiat: parsed.feeFiat,
      expiresAt: parsed.expiresAt,
      quoteId: parsed.quoteId,
    };
  },

  async executeBuy(input) {
    await creds();
    return { orderId: `mp_order_${input.quoteId}` };
  },

  async verifyWebhook(rawBody, headers) {
    const sig = headers['moonpay-signature-v2'] ?? '';
    if (!sig) return false;
    const { webhookSecret } = await creds();
    return safeEquals(sig, hmacSha256(webhookSecret, rawBody));
  },
};
