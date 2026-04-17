import { z } from 'zod';

export const BulkItem = z.object({
  id: z.string().min(1).max(256),
});

export const BulkRequest = z.object({
  items: z.array(BulkItem).min(1).max(10),
});

export const BulkResponse = z.object({
  ok: z.literal(true),
  txHash: z.string(),
  resource: z.string(),
  accountId: z.string().uuid(),
  items: z.array(
    z.object({
      id: z.string(),
      status: z.literal('completed'),
    }),
  ),
  totalItems: z.number().int().positive(),
});

/** @typedef {z.infer<typeof BulkItem>} BulkItem */
/** @typedef {z.infer<typeof BulkRequest>} BulkRequest */
/** @typedef {z.infer<typeof BulkResponse>} BulkResponse */
