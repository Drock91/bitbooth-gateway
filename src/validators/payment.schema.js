import { z } from 'zod';
import { XrplTxHash } from './xrpl-payment.schema.js';
import { Caip2Network } from './caip2.js';
export { Caip2Network };

export const HexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address');
export const HexTxHash = z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid tx hash');
export const WeiAmount = z.string().regex(/^\d+$/, 'Wei must be unsigned integer string');

export const CreateChallengeRequest = z.object({
  resource: z.string().min(1).max(256),
  amountWei: WeiAmount,
  assetSymbol: z.string().min(1).max(16),
});

export const SolanaTxSignature = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/, 'Invalid Solana tx signature');

export const TxReference = z.union([HexTxHash, SolanaTxSignature, XrplTxHash]);

export const PaymentHeader = z.object({
  nonce: z.string().min(16).max(64),
  txHash: TxReference,
  signature: z.string().min(1),
  network: Caip2Network.optional(),
});

export const IdempotencyKey = z.string().uuid();

export const PaymentsHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
