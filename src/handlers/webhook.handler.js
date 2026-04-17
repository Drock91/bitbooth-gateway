import { randomUUID } from 'node:crypto';
import { jsonResponse, toHttpResponse } from '../middleware/error.middleware.js';
import { UnauthorizedError, isAppError } from '../lib/errors.js';
import { getAdapter } from '../services/routing.service.js';
import { SupportedExchange } from '../validators/exchange.schema.js';
import { withRequestLogging } from '../middleware/request-log.middleware.js';
import { webhookDlqRepo } from '../repositories/webhook-dlq.repo.js';
import { withCorrelation } from '../lib/logger.js';
import { withBodySizeLimit } from '../middleware/body-size.middleware.js';
import { withGracefulShutdown } from '../middleware/shutdown.middleware.js';
import { withSecurityHeaders } from '../middleware/security-headers.middleware.js';

export const handler = withGracefulShutdown(
  withSecurityHeaders(
    withRequestLogging(
      withBodySizeLimit(async (event, { correlationId }) => {
        try {
          const provider = SupportedExchange.parse(event.pathParameters?.provider);
          const adapter = getAdapter(provider);
          const headers = {};
          for (const [k, v] of Object.entries(event.headers ?? {}))
            if (v) headers[k.toLowerCase()] = v;

          const ok = await adapter.verifyWebhook(event.body ?? '', headers);
          if (!ok) throw new UnauthorizedError('webhook signature invalid');

          return jsonResponse(200, { ok: true });
        } catch (err) {
          const log = withCorrelation(correlationId);
          try {
            const provider = event.pathParameters?.provider ?? 'unknown';
            await webhookDlqRepo.record({
              eventId: randomUUID(),
              provider,
              payload: (event.body ?? '').slice(0, 65536),
              headers: event.headers ?? {},
              errorMessage: err?.message ?? 'Unknown error',
              errorCode: isAppError(err) ? err.code : 'INTERNAL_ERROR',
            });
          } catch (dlqErr) {
            log.error({ err: dlqErr }, 'failed to record webhook event to DLQ');
          }
          return toHttpResponse(err, correlationId);
        }
      }),
    ),
  ),
);
