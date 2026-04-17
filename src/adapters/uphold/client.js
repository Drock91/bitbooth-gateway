import { getSecretJson } from '../../lib/secrets.js';
import { getConfig } from '../../lib/config.js';
import { UpstreamError } from '../../lib/errors.js';
import { hmacSha256, safeEquals } from '../../lib/crypto.js';

async function creds() {
  const arn = getConfig().secretArns.uphold;
  if (!arn) throw new UpstreamError('uphold', { reason: 'not-configured' });
  return getSecretJson(arn);
}

export const upholdAdapter = {
  name: 'uphold',

  async quote(input) {
    await creds();
    return {
      exchange: 'uphold',
      fiatCurrency: input.fiatCurrency,
      fiatAmount: input.fiatAmount,
      cryptoAmount: (input.fiatAmount * 0.9985).toString(),
      cryptoAsset: input.cryptoAsset,
      feeFiat: input.fiatAmount * 0.015,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      quoteId: `up_${Date.now()}`,
    };
  },

  async executeBuy(input) {
    await creds();
    return { orderId: `up_order_${input.quoteId}` };
  },

  async verifyWebhook(rawBody, headers) {
    const sig = headers['uphold-signature'] ?? '';
    if (!sig) return false;
    const { webhookSecret } = await creds();
    return safeEquals(sig, hmacSha256(webhookSecret, rawBody));
  },
};
