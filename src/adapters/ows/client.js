import { z } from 'zod';

/**
 * Open Wallet Standard (OWS) adapter.
 */

export const OwsAccount = z.object({
  did: z.string().min(3),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chain: z.literal('xrpl-evm'),
  capabilities: z.array(z.enum(['sign', 'pay', 'attest'])),
});

export const OwsSignRequest = z.object({
  did: z.string(),
  message: z.string(),
  purpose: z.enum(['x402-payment', 'login', 'consent']),
});

export const OwsSignResponse = z.object({
  signature: z.string(),
  did: z.string(),
  signedAt: z.number(),
});

export const owsAdapter = {
  name: 'ows',

  parseAccount(raw) {
    return OwsAccount.parse(raw);
  },

  parseSignRequest(raw) {
    return OwsSignRequest.parse(raw);
  },

  buildSignResponse(sig, did) {
    return OwsSignResponse.parse({ signature: sig, did, signedAt: Math.floor(Date.now() / 1000) });
  },
};
