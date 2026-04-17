import { getSecretJson } from '../../lib/secrets.js';
import { getConfig } from '../../lib/config.js';
import { UpstreamError } from '../../lib/errors.js';
import { hmacSha256, safeEquals } from '../../lib/crypto.js';

async function creds() {
  const arn = getConfig().secretArns.binance;
  if (!arn) throw new UpstreamError('binance', { reason: 'not-configured' });
  return getSecretJson(arn);
}

export const binanceAdapter = {
  name: 'binance',

  async quote(input) {
    const c = await creds();
    return {
      exchange: c.useUs ? 'binance-us' : 'binance',
      fiatCurrency: input.fiatCurrency,
      fiatAmount: input.fiatAmount,
      cryptoAmount: (input.fiatAmount * 0.9993).toString(),
      cryptoAsset: input.cryptoAsset,
      feeFiat: input.fiatAmount * 0.001,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      quoteId: `bn_${Date.now()}`,
    };
  },

  async executeBuy(input) {
    await creds();
    return { orderId: `bn_order_${input.quoteId}` };
  },

  async verifyWebhook(rawBody, headers) {
    const sig = headers['binance-signature'] ?? '';
    if (!sig) return false;
    const { webhookSecret } = await creds();
    return safeEquals(sig, hmacSha256(webhookSecret, rawBody));
  },
};
