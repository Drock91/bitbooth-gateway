import { dashboardService } from '../services/dashboard.service.js';
import { isAppError, ValidationError } from '../lib/errors.js';
import { DashboardQuery } from '../validators/dashboard.schema.js';
import { UpdateRouteInput, DeleteRouteInput } from '../validators/route.schema.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { jsonResponse } from '../middleware/error.middleware.js';
import { routeCreated, routeDeleted, apiKeyRotated } from '../lib/metrics.js';
import {
  enforceSignupRateLimit,
  extractClientIp,
  rateLimitHeaders,
} from '../middleware/rate-limit.middleware.js';
import { renderPage } from '../lib/templates.js';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";

function htmlResponse(status, body) {
  return {
    statusCode: status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
    },
    body,
  };
}

export async function getDashboard(event) {
  const parsed = DashboardQuery.safeParse(event.queryStringParameters ?? {});

  if (!parsed.success) {
    return htmlResponse(400, renderPage({ error: 'Invalid account ID format. Must be a UUID.' }));
  }

  const { accountId } = parsed.data;
  let payments = null;

  if (accountId) {
    payments = await dashboardService.getRecentPayments(accountId);
  }

  return htmlResponse(200, renderPage({ payments }));
}

export async function postRotateKey(event) {
  const { accountId } = await authenticate(event.headers ?? {});
  const result = await dashboardService.rotateKey(accountId);
  apiKeyRotated({ accountId });
  return jsonResponse(200, {
    accountId: result.accountId,
    apiKey: result.apiKey,
    message: 'API key rotated. Save this key now — it will not be shown again.',
  });
}

export async function putRoute(event) {
  const { accountId } = await authenticate(event.headers ?? {});
  const body = JSON.parse(event.body ?? '{}');
  const parsed = UpdateRouteInput.safeParse(body);
  if (!parsed.success) throw new ValidationError('Invalid route input', parsed.error.issues);
  const route = await dashboardService.upsertRoute(accountId, parsed.data);
  routeCreated({ accountId, path: parsed.data.path });
  return jsonResponse(200, route);
}

export async function deleteRoute(event) {
  const { accountId } = await authenticate(event.headers ?? {});
  const body = JSON.parse(event.body ?? '{}');
  const parsed = DeleteRouteInput.safeParse(body);
  if (!parsed.success) throw new ValidationError('Invalid route input', parsed.error.issues);
  await dashboardService.removeRoute(accountId, parsed.data.path);
  routeDeleted({ accountId, path: parsed.data.path });
  return jsonResponse(200, { ok: true });
}

export async function getRoutes(event) {
  const { accountId } = await authenticate(event.headers ?? {});
  const routes = await dashboardService.listRoutes(accountId);
  return jsonResponse(200, { routes });
}

export async function postSignup(event) {
  try {
    const clientIp = extractClientIp(event);
    const rlInfo = await enforceSignupRateLimit(clientIp);
    const signupResult = await dashboardService.signup();
    const resp = htmlResponse(200, renderPage({ signupResult }));
    Object.assign(resp.headers, rateLimitHeaders(rlInfo));
    return resp;
  } catch (err) {
    const msg = isAppError(err) ? err.message : 'Signup failed. Please try again.';
    return htmlResponse(isAppError(err) ? err.status : 500, renderPage({ error: msg }));
  }
}
