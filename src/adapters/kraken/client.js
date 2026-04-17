import { getSecretJson } from '../../lib/secrets.js';
import { getConfig } from '../../lib/config.js';
import { UpstreamError } from '../../lib/errors.js';
import { hmacSha256, safeEquals } from '../../lib/crypto.js';

async function creds() {
  const arn = getConfig().secretArns.kraken;
  if (!arn) throw new UpstreamError('kraken', { reason: 'not-configured' });
  return getSecretJson(arn);
}

export const krakenAdapter = {
  name: 'kraken',

  async quote(input) {
    await creds();
    return {
      exchange: 'kraken',
      fiatCurrency: input.fiatCurrency,
      fiatAmount: input.fiatAmount,
      cryptoAmount: (input.fiatAmount * 0.9992).toString(),
      cryptoAsset: input.cryptoAsset,
      feeFiat: input.fiatAmount * 0.0026,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      quoteId: `kr_${Date.now()}`,
    };
  },

  async executeBuy(input) {
    await creds();
    return { orderId: `kr_order_${input.quoteId}` };
  },

  async verifyWebhook(rawBody, headers) {
    const sig = headers['kraken-signature'] ?? '';
    if (!sig) return false;
    const { webhookSecret } = await creds();
    return safeEquals(sig, hmacSha256(webhookSecret, rawBody));
  },
};
