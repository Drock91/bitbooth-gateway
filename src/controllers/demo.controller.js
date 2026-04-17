import { dashboardService } from '../services/dashboard.service.js';
import { DemoSignupInput } from '../validators/demo.schema.js';
import { ValidationError } from '../lib/errors.js';
import { jsonResponse } from '../middleware/error.middleware.js';
import { demoSignup } from '../lib/metrics.js';
import { logger } from '../lib/logger.js';
import {
  enforceSignupRateLimit,
  extractClientIp,
  rateLimitHeaders,
} from '../middleware/rate-limit.middleware.js';

function emailDomainOf(email) {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : 'unknown';
}

export async function postDemoSignup(event) {
  const clientIp = extractClientIp(event);
  const rlInfo = await enforceSignupRateLimit(clientIp);

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    throw new ValidationError('Body must be valid JSON');
  }

  const parsed = DemoSignupInput.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid demo signup input', parsed.error.issues);
  }

  const { email } = parsed.data;
  const signupResult = await dashboardService.signup();

  logger.info(
    { event: 'demo.signup', accountId: signupResult.accountId, email, clientIp },
    'demo signup succeeded',
  );
  demoSignup({ accountId: signupResult.accountId, emailDomain: emailDomainOf(email) });

  const resp = jsonResponse(200, {
    accountId: signupResult.accountId,
    apiKey: signupResult.apiKey,
    plan: signupResult.plan,
    docsUrl: '/docs',
    dashboardUrl: `/dashboard?accountId=${signupResult.accountId}`,
    message: 'Save this API key now — it will not be shown again.',
  });
  Object.assign(resp.headers, rateLimitHeaders(rlInfo));
  return resp;
}
