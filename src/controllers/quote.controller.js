import { quoteService } from '../services/quote.service.js';
import { parseBody } from '../middleware/validate.middleware.js';
import { QuoteRequest } from '../validators/exchange.schema.js';
import { jsonResponse } from '../middleware/error.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { enforceRateLimit, rateLimitHeaders } from '../middleware/rate-limit.middleware.js';

export async function postQuote(event) {
  const headers = normalize(event.headers);
  const { accountId, plan } = await authenticate(headers);
  const rlInfo = await enforceRateLimit(accountId, plan);

  const input = parseBody(QuoteRequest, event.body);
  const quote = await quoteService.getBest(input);

  const resp = jsonResponse(200, { quote });
  Object.assign(resp.headers, rateLimitHeaders(rlInfo));
  return resp;
}

function normalize(h) {
  const out = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = v ?? undefined;
  return out;
}
