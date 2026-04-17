import { z } from 'zod';
import { SupportedExchange } from './exchange.schema.js';

export const DlqStatus = z.enum(['pending', 'retried', 'resolved']);

export const WebhookDlqItem = z.object({
  eventId: z.string().uuid(),
  provider: SupportedExchange,
  payload: z.string(),
  headers: z.record(z.string()),
  errorMessage: z.string(),
  errorCode: z.string(),
  status: DlqStatus,
  retryCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  ttl: z.number().int().positive().optional(),
});

export const WebhookDlqInput = z.object({
  eventId: z.string().uuid(),
  provider: SupportedExchange,
  payload: z.string(),
  headers: z.record(z.string()),
  errorMessage: z.string(),
  errorCode: z.string(),
});
