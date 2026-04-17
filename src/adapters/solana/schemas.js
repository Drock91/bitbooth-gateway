import { z } from 'zod';

export const TokenBalance = z.object({
  accountIndex: z.number().int().nonnegative(),
  mint: z.string().min(32).max(44),
  owner: z.string().min(32).max(44).optional().nullable(),
  uiTokenAmount: z.object({
    amount: z.string().regex(/^\d+$/),
    decimals: z.number().int().nonnegative(),
    uiAmount: z.number().nullable().optional(),
    uiAmountString: z.string().optional(),
  }),
});

export const SolanaTx = z
  .object({
    slot: z.number().int().positive(),
    blockTime: z.number().int().nullable().optional(),
    meta: z
      .object({
        err: z.unknown().nullable(),
        preTokenBalances: z.array(TokenBalance).nullable().optional(),
        postTokenBalances: z.array(TokenBalance).nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const VerifyPaymentResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), blockNumber: z.number().int().nonnegative() }),
  z.object({ ok: z.literal(false), reason: z.string().min(1) }),
]);
