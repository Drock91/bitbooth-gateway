import { checkReady } from '../services/health.service.js';
import { jsonResponse } from '../middleware/error.middleware.js';
import {
  enforceHealthRateLimit,
  extractClientIp,
  rateLimitHeaders,
} from '../middleware/rate-limit.middleware.js';

export async function getHealth(event) {
  const clientIp = extractClientIp(event);
  const rlInfo = await enforceHealthRateLimit(clientIp);
  const res = jsonResponse(200, { ok: true, stage: process.env.STAGE });
  res.headers = { ...res.headers, ...rateLimitHeaders(rlInfo) };
  return res;
}

export async function getHealthReady(event) {
  const clientIp = extractClientIp(event);
  const rlInfo = await enforceHealthRateLimit(clientIp);
  const result = await checkReady();
  const status = result.ok ? 200 : 503;
  const res = jsonResponse(status, result);
  res.headers = { ...res.headers, ...rateLimitHeaders(rlInfo) };
  return res;
}
