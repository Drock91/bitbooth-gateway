import { portalService } from '../services/portal.service.js';
import { dashboardService } from '../services/dashboard.service.js';
import { usageRepo } from '../repositories/usage.repo.js';
import { rateLimitRepo } from '../repositories/rate-limit.repo.js';
import { tenantsRepo } from '../repositories/tenants.repo.js';
import { PortalLoginBody } from '../validators/portal.schema.js';
import { ValidationError } from '../lib/errors.js';
import { THEME_CSS } from '../static/theme.css.js';
import { escapeHtml } from '../lib/templates.js';
import { renderPortalDashboard, renderPortalIntegrate } from '../lib/portal-templates.js';

const PORTAL_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "frame-ancestors 'none'",
].join('; ');

function htmlResponse(status, body) {
  return {
    statusCode: status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': PORTAL_CSP,
      'x-content-type-options': 'nosniff',
    },
    body,
  };
}

function renderLoginPage({ error } = {}) {
  const errorBlock = error ? `<div class="alert error">${escapeHtml(error)}</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x402 — Sign In</title>
<style>${THEME_CSS}
.portal-wrap { max-width: 420px; margin: var(--sp-16) auto; padding: 0 var(--sp-4); }
.portal-title { font-size: var(--text-2xl); font-weight: 700; margin-bottom: var(--sp-2); }
.portal-sub { color: var(--ink-dim); font-size: var(--text-sm); margin-bottom: var(--sp-8); }
.form-group { margin-bottom: var(--sp-5); }
.form-group label { margin-bottom: var(--sp-2); }
.login-btn { width: 100%; margin-top: var(--sp-2); }
</style>
</head>
<body>
<div class="portal-wrap">
  <div class="portal-title">x402</div>
  <p class="portal-sub">Sign in to your client portal</p>
  ${errorBlock}
  <div class="card">
    <form method="POST" action="/portal/login">
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required placeholder="you@example.com">
      </div>
      <div class="form-group">
        <label for="apiKey">API Key</label>
        <input type="password" id="apiKey" name="apiKey" required placeholder="x402_...">
      </div>
      <button type="submit" class="btn btn-primary login-btn">Sign In</button>
    </form>
  </div>
  <p class="muted" style="margin-top: var(--sp-4); text-align: center;">
    Don't have an account? <a href="/dashboard">Sign up</a>
  </p>
</div>
</body>
</html>`;
}

export async function getPortal() {
  return htmlResponse(200, renderLoginPage());
}

export async function postLogin(event) {
  const raw = event.body ?? '';
  const params = new URLSearchParams(raw);
  const parsed = PortalLoginBody.safeParse({
    email: params.get('email') ?? '',
    apiKey: params.get('apiKey') ?? '',
  });

  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues);
  }

  const { apiKey } = parsed.data;
  const tenant = await portalService.verifyApiKey(apiKey);
  const cookie = await portalService.createSessionCookie(tenant.accountId, tenant.plan);

  return {
    statusCode: 303,
    headers: {
      location: '/portal/dashboard',
      'set-cookie': cookie.options,
      'cache-control': 'no-store',
    },
    body: '',
  };
}

export async function getLogout() {
  return {
    statusCode: 303,
    headers: {
      location: '/portal',
      'set-cookie': portalService.clearCookie(),
      'cache-control': 'no-store',
    },
    body: '',
  };
}

export async function getPortalDashboard(event) {
  const cookieHeader = event.headers?.cookie || event.headers?.Cookie || '';
  const session = await portalService.validateSession(cookieHeader);

  const [tenant, payments, routes, usage, bucket] = await Promise.all([
    tenantsRepo.getByAccountId(session.accountId),
    dashboardService.getRecentPayments(session.accountId, 20),
    dashboardService.listRoutes(session.accountId),
    usageRepo.listByAccount(session.accountId, 6),
    rateLimitRepo.getBucket(session.accountId),
  ]);

  const html = renderPortalDashboard({
    tenant,
    payments,
    routes,
    usage,
    rateLimitBucket: bucket,
  });

  return htmlResponse(200, html);
}

export async function getPortalIntegrate(event) {
  const cookieHeader = event.headers?.cookie || event.headers?.Cookie || '';
  const session = await portalService.validateSession(cookieHeader);

  return htmlResponse(
    200,
    renderPortalIntegrate({
      accountId: session.accountId,
      plan: session.plan,
    }),
  );
}

export async function postPortalRotateKey(event) {
  const cookieHeader = event.headers?.cookie || event.headers?.Cookie || '';
  const session = await portalService.validateSession(cookieHeader);
  const result = await dashboardService.rotateKey(session.accountId);

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify({
      accountId: result.accountId,
      apiKey: result.apiKey,
      message: 'API key rotated. Save this key now — it will not be shown again.',
    }),
  };
}
