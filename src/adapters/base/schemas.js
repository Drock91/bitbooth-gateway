import { z } from 'zod';

const HexAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v.toLowerCase());

const HexHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const TransferEvent = z.object({
  from: HexAddress,
  to: HexAddress,
  amount: z.bigint().nonnegative(),
});

export const VerifyPaymentInput = z.object({
  txHash: HexHash,
  expectedTo: HexAddress,
  expectedAmountWei: z.bigint().nonnegative(),
  minConfirmations: z.number().int().min(1),
});

export const VerifyPaymentResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), blockNumber: z.number().int().optional() }),
  z.object({ ok: z.literal(false), reason: z.string().min(1) }),
]);
