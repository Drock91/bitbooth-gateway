import { earningsService } from '../services/earnings.service.js';
import { adminService } from '../services/admin.service.js';
import { jsonResponse } from '../middleware/error.middleware.js';
import { enforceAdminRateLimit, rateLimitHeaders } from '../middleware/rate-limit.middleware.js';
import { renderEarningsPage } from '../static/earnings.html.js';
import { stagePrefix } from '../lib/stage-prefix.js';

/**
 * GET /admin/earnings       — HTML dashboard (Grafana-style)
 * GET /admin/earnings.json  — raw JSON aggregates for programmatic / auto-refresh access
 *
 * Both require an admin session cookie (same as /admin/tenants).
 * Sign in once at /admin (enter admin key) -> cookie set -> dashboard works.
 * The HTML page re-fetches /admin/earnings.json every 30s via fetch().
 */

function extractIp(event) {
  return (
    event?.requestContext?.identity?.sourceIp || event?.requestContext?.http?.sourceIp || 'unknown'
  );
}

async function requireSession(event) {
  const clientIp = extractIp(event);
  const rlInfo = await enforceAdminRateLimit(clientIp);
  const cookieHeader = event?.headers?.cookie || event?.headers?.Cookie || '';
  const session = await adminService.validateSession(cookieHeader);
  return { session, rlInfo };
}

function parseMode(event) {
  const raw = event?.queryStringParameters?.mode;
  if (raw === 'testnet' || raw === 'all') return raw;
  return 'real';
}

export async function getEarningsJson(event) {
  const { session, rlInfo } = await requireSession(event);
  const mode = parseMode(event);
  const summary = await earningsService.summary({ mode });
  const res = jsonResponse(200, summary);
  res.headers = {
    ...res.headers,
    ...rateLimitHeaders(rlInfo),
    ...(session.refreshCookie ? { 'set-cookie': session.refreshCookie } : {}),
  };
  return res;
}

export async function getEarningsHtml(event) {
  const { session, rlInfo } = await requireSession(event);
  const html = renderEarningsPage(stagePrefix(event));
  return {
    statusCode: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'none'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
        "connect-src 'self'; " +
        "font-src 'self'; " +
        "img-src 'self' data:; " +
        "frame-ancestors 'none'",
      ...rateLimitHeaders(rlInfo),
      ...(session.refreshCookie ? { 'set-cookie': session.refreshCookie } : {}),
    },
    body: html,
  };
}
