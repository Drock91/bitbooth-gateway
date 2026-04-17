import { z } from 'zod';

export const Caip2Network = z
  .string()
  .regex(/^[a-z][a-z0-9-]*:[a-zA-Z0-9]{1,64}$/, 'Invalid CAIP-2 network ID');

export function parseCaip2(network) {
  const idx = network.indexOf(':');
  if (idx === -1) return null;
  const namespace = network.slice(0, idx);
  const reference = network.slice(idx + 1);
  if (!namespace || !reference) return null;
  return { namespace, reference };
}

export function isXrplNetwork(network) {
  const parsed = parseCaip2(network);
  return parsed !== null && parsed.namespace === 'xrpl';
}

export function isEvmNetwork(network) {
  const parsed = parseCaip2(network);
  return parsed !== null && parsed.namespace === 'eip155';
}

export function isSolanaNetwork(network) {
  const parsed = parseCaip2(network);
  return parsed !== null && parsed.namespace === 'solana';
}
