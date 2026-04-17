import { z } from 'zod';

export const IdempotencyKey = z.string().uuid();

export const IdempotencyRecord = z.object({
  idempotencyKey: IdempotencyKey,
  status: z.enum(['in_progress', 'completed']),
  statusCode: z.number().int().optional(),
  responseBody: z.string().optional(),
  responseHeaders: z.record(z.string()).optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  ttl: z.number().int(),
});
