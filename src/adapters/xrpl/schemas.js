import { z } from 'zod';
import { XrplAddress, DropsAmount, IouAmount } from '../../validators/xrpl-payment.schema.js';

export const TxResult = z.object({
  TransactionType: z.string(),
  Account: XrplAddress,
  Destination: XrplAddress,
  validated: z.boolean(),
  meta: z.object({
    TransactionResult: z.string(),
    delivered_amount: z.union([DropsAmount, IouAmount]).optional(),
  }),
  ledger_index: z.number().int().positive(),
});

export const VerifyPaymentResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), ledgerIndex: z.number().int().optional() }),
  z.object({ ok: z.literal(false), reason: z.string().min(1) }),
]);
