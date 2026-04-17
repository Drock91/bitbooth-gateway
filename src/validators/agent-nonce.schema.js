import { z } from 'zod';

export const WalletAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid EVM address');

export const NonceValue = z.number().int().nonnegative();

export const AgentNonceItem = z.object({
  walletAddress: WalletAddress,
  currentNonce: NonceValue,
  lastUsedAt: z.string().datetime(),
});
