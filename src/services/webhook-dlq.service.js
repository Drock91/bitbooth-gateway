import { webhookDlqRepo } from '../repositories/webhook-dlq.repo.js';
import { getAdapter } from './routing.service.js';
import { logger } from '../lib/logger.js';

const MAX_RETRIES = Number(process.env.DLQ_MAX_RETRIES) || 5;
const BATCH_SIZE = Number(process.env.DLQ_SWEEP_BATCH_SIZE) || 25;
const BASE_DELAY_MS = Number(process.env.DLQ_BASE_DELAY_MS) || 300_000; // 5 min
const MAX_DELAY_MS = Number(process.env.DLQ_MAX_DELAY_MS) || 14_400_000; // 4 hours

/**
 * Deterministic exponential backoff: min(maxDelay, baseDelay * 2^retryCount).
 * No jitter — the sweep schedule already provides temporal distribution.
 */
export function computeBackoff(retryCount) {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** retryCount);
}

/**
 * Sweep all pending DLQ entries. For each:
 * - If retryCount >= MAX_RETRIES → mark resolved (exhausted)
 * - If backoff window hasn't elapsed → skip
 * - Otherwise → re-verify webhook; resolve on success, increment retry on failure
 */
export async function sweepDlq() {
  const log = logger.child({ op: 'dlq-sweep' });
  let processed = 0;
  let retried = 0;
  let exhausted = 0;
  let skipped = 0;
  let failed = 0;
  let cursor;

  do {
    const { items, lastKey } = await webhookDlqRepo.listPending(BATCH_SIZE, cursor);
    cursor = lastKey;

    for (const entry of items) {
      processed++;

      if (entry.retryCount >= MAX_RETRIES) {
        await webhookDlqRepo.updateStatus(entry.eventId, 'resolved');
        exhausted++;
        log.info(
          { eventId: entry.eventId, provider: entry.provider, retryCount: entry.retryCount },
          'DLQ entry exhausted retries',
        );
        continue;
      }

      const backoffMs = computeBackoff(entry.retryCount);
      const dueAt = new Date(entry.updatedAt).getTime() + backoffMs;
      if (Date.now() < dueAt) {
        skipped++;
        continue;
      }

      try {
        const adapter = getAdapter(entry.provider);
        await adapter.verifyWebhook(entry.payload, entry.headers);
        await webhookDlqRepo.updateStatus(entry.eventId, 'resolved');
        retried++;
        log.info(
          { eventId: entry.eventId, provider: entry.provider },
          'DLQ entry retried successfully',
        );
      } catch (err) {
        await webhookDlqRepo.incrementRetry(entry.eventId);
        failed++;
        log.warn(
          { eventId: entry.eventId, provider: entry.provider, err: err.message },
          'DLQ retry failed',
        );
      }
    }
  } while (cursor);

  return { processed, retried, exhausted, skipped, failed };
}
