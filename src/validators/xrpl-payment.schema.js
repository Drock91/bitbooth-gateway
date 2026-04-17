import { z } from 'zod';

export const XrplAddress = z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);

export const XrplTxHash = z.string().regex(/^[0-9A-Fa-f]{64}$/);

export const IouAmount = z.object({
  currency: z.string().min(3).max(40),
  issuer: XrplAddress,
  value: z.string().regex(/^-?\d+(\.\d+)?$/),
});

export const DropsAmount = z.string().regex(/^\d+$/);

export const DeliveredAmount = z.union([DropsAmount, IouAmount]);

export const XrplVerifyPaymentInput = z.object({
  txHash: XrplTxHash,
  destination: XrplAddress,
  amount: DeliveredAmount,
  issuer: XrplAddress.optional(),
});
