import { paymentsService } from '../services/payments.service.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { enforceRateLimit, rateLimitHeaders } from '../middleware/rate-limit.middleware.js';
import { withIdempotency } from '../middleware/idempotency.middleware.js';
import { routesService } from '../services/routes.service.js';
import { jsonResponse } from '../middleware/error.middleware.js';
import { PaymentsHistoryQuery } from '../validators/payment.schema.js';
import { BulkRequest } from '../validators/bulk.schema.js';
import { ValidationError } from '../lib/errors.js';

export async function requirePaidResource(event) {
  const headers = normalize(event.headers);
  const { accountId, plan } = await authenticate(headers);

  const rlInfo = await enforceRateLimit(accountId, plan);

  return withIdempotency(headers, async () => {
    const route = await routesService.getRouteConfig(accountId, event.path);

    const result = await paymentsService.requirePayment({
      route,
      headers,
      accountId,
    });

    const resp = jsonResponse(200, {
      ok: true,
      txHash: result.txHash,
      resource: event.path,
      accountId,
    });
    Object.assign(resp.headers, rateLimitHeaders(rlInfo));
    return resp;
  });
}

export async function getPayments(event) {
  const headers = normalize(event.headers);
  const { accountId, plan } = await authenticate(headers);
  const rlInfo = await enforceRateLimit(accountId, plan);

  const parsed = PaymentsHistoryQuery.safeParse(event.queryStringParameters ?? {});
  if (!parsed.success) {
    throw new ValidationError('Invalid query parameters', parsed.error.issues);
  }

  const { limit, cursor } = parsed.data;
  const result = await paymentsService.listPayments(accountId, { limit, cursor });

  const resp = jsonResponse(200, {
    payments: result.payments,
    nextCursor: result.nextCursor,
  });
  Object.assign(resp.headers, rateLimitHeaders(rlInfo));
  return resp;
}

export async function requireBulkResource(event) {
  const headers = normalize(event.headers);
  const { accountId, plan } = await authenticate(headers);

  const rlInfo = await enforceRateLimit(accountId, plan);

  const body = JSON.parse(event.body ?? '{}');
  const parsed = BulkRequest.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid bulk request', parsed.error.issues);
  }

  const { items } = parsed.data;

  return withIdempotency(headers, async () => {
    const route = await routesService.getRouteConfig(accountId, event.path);

    const totalWei = (BigInt(route.amountWei) * BigInt(items.length)).toString();
    const bulkRoute = { ...route, amountWei: totalWei };

    const result = await paymentsService.requirePayment({
      route: bulkRoute,
      headers,
      accountId,
    });

    const resp = jsonResponse(200, {
      ok: true,
      txHash: result.txHash,
      resource: event.path,
      accountId,
      items: items.map((item) => ({ id: item.id, status: 'completed' })),
      totalItems: items.length,
    });
    Object.assign(resp.headers, rateLimitHeaders(rlInfo));
    return resp;
  });
}

function normalize(h) {
  const out = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = v ?? undefined;
  return out;
}
