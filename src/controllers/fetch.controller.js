import { fetchService } from '../services/fetch.service.js';
import { parseBody } from '../middleware/validate.middleware.js';
import { FetchRequest } from '../validators/fetch.schema.js';
import { jsonResponse } from '../middleware/error.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { enforceRateLimit, rateLimitHeaders } from '../middleware/rate-limit.middleware.js';
import { enforceX402 } from '../middleware/x402.middleware.js';
import { UnauthorizedError } from '../lib/errors.js';

/**
 * Fixed route config for /v1/fetch. Payment-per-call is the entire auth model:
 * no API key required, no tenant signup, just pay via x402 and get markdown.
 * This is the flagship agent-native endpoint — `npm install @bitbooth/mcp-fetch`
 * and go. Other endpoints (/v1/resource, /v1/fetch/bulk) still require API keys
 * + tenant signup; /v1/fetch is intentionally permissionless.
 */
const FETCH_ROUTE = {
  resource: '/v1/fetch',
  amountWei: process.env.FETCH_PRICE_WEI || '5000', // 0.005 USDC (6 decimals)
  assetSymbol: 'USDC',
  fraudRules: undefined,
};

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

  // x402 challenge + verify. Throws 402 with accepts[] if no X-PAYMENT
  // header; throws 402 with a reason if the payment is invalid.
  await enforceX402({ headers, accountId, route: FETCH_ROUTE });

  const input = parseBody(FetchRequest, event.body);
  const result = await fetchService.fetch(input);

  const resp = jsonResponse(200, result);
  Object.assign(resp.headers, rateLimitHeaders(rlInfo));
  return resp;
}

function normalize(h) {
  const out = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = v ?? undefined;
  return out;
}
