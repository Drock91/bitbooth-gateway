import { fetchService } from '../services/fetch.service.js';
import { parseBody } from '../middleware/validate.middleware.js';
import { FetchRequest } from '../validators/fetch.schema.js';
import { jsonResponse } from '../middleware/error.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  enforceRateLimit,
  enforceMonthlyQuota,
  rateLimitHeaders,
} from '../middleware/rate-limit.middleware.js';
import { enforceX402 } from '../middleware/x402.middleware.js';
import { UnauthorizedError, RenderNotAllowedError } from '../lib/errors.js';

const FETCH_PRICE_WEI = process.env.FETCH_PRICE_WEI || '5000'; // 0.005 USDC
const RENDER_PRICE_WEI = process.env.RENDER_PRICE_WEI || '20000'; // 0.02 USDC
const SHARED_FETCH_PRICE_WEI = process.env.SHARED_FETCH_PRICE_WEI || '1000'; // 0.001 USDC
const SHARED_RENDER_PRICE_WEI = process.env.SHARED_RENDER_PRICE_WEI || '4000'; // 0.004 USDC

function fetchRoute(mode, cached = false) {
  const full = mode === 'render' ? RENDER_PRICE_WEI : FETCH_PRICE_WEI;
  const shared = mode === 'render' ? SHARED_RENDER_PRICE_WEI : SHARED_FETCH_PRICE_WEI;
  return {
    resource: '/v1/fetch',
    amountWei: cached ? shared : full,
    assetSymbol: 'USDC',
    fraudRules: undefined,
  };
}

export async function postFetch(event) {
  const headers = normalize(event.headers);
  const sourceIp = event.requestContext?.identity?.sourceIp || 'unknown';

  // Optional API key. If present -> registered tenant (higher rate limits,
  // plan-based pricing). If absent -> anonymous (rate limit by IP, x402-only).
  // Either way, x402 payment is required on every call.
  let accountId;
  let plan;
  try {
    const authed = await authenticate(headers);
    accountId = authed.accountId;
    plan = authed.plan;
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err;
    accountId = `anon:${sourceIp}`;
    plan = 'free';
  }

  const rlInfo = await enforceRateLimit(accountId, plan);
  const quotaInfo = await enforceMonthlyQuota(accountId, plan);

  const input = parseBody(FetchRequest, event.body);

  if (input.mode === 'render' && plan === 'free') {
    throw new RenderNotAllowedError(plan);
  }

  // Cache hits get a reduced "shared" price — the first fetcher paid full
  // price, subsequent agents within the TTL window pay ~20%.
  const cached = await fetchService.isCached(input.url, input.mode);
  await enforceX402({ headers, accountId, route: fetchRoute(input.mode, cached) });

  const result = await fetchService.fetch(input);

  const resp = jsonResponse(200, result);
  Object.assign(resp.headers, rateLimitHeaders(rlInfo), {
    'x-monthly-quota-limit': String(quotaInfo.limit),
    'x-monthly-quota-remaining': String(quotaInfo.remaining),
  });
  return resp;
}

function normalize(h) {
  const out = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = v ?? undefined;
  return out;
}
