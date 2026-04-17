import { getSecretJson } from '../../lib/secrets.js';
import { getConfig } from '../../lib/config.js';
import { UpstreamError } from '../../lib/errors.js';
import { hmacSha256, safeEquals } from '../../lib/crypto.js';

async function creds() {
  const arn = getConfig().secretArns.coinbase;
  if (!arn) throw new UpstreamError('coinbase', { reason: 'not-configured' });
  return getSecretJson(arn);
}

export const coinbaseAdapter = {
  name: 'coinbase',

  async quote(input) {
    await creds();
    return {
      exchange: 'coinbase',
      fiatCurrency: input.fiatCurrency,
      fiatAmount: input.fiatAmount,
      cryptoAmount: (input.fiatAmount * 0.999).toString(),
      cryptoAsset: input.cryptoAsset,
      feeFiat: input.fiatAmount * 0.0099,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      quoteId: `cb_${Date.now()}`,
    };
  },

  async executeBuy(input) {
    await creds();
    return { orderId: `cb_order_${input.quoteId}` };
  },

  async verifyWebhook(rawBody, headers) {
    const sig = headers['cb-signature'] ?? '';
    if (!sig) return false;
    const { webhookSecret } = await creds();
    return safeEquals(sig, hmacSha256(webhookSecret, rawBody));
  },
};
