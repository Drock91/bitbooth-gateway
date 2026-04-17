import { adminService } from '../services/admin.service.js';
import { metricsService } from '../services/metrics.service.js';
import { jsonResponse } from '../middleware/error.middleware.js';
import {
  AdminTenantsQuery,
  AdminTenantsUIQuery,
  AdminLoginBody,
  AdminChangePasswordBody,
} from '../validators/admin.schema.js';
import { ValidationError } from '../lib/errors.js';
import { THEME_CSS } from '../static/theme.css.js';
import { escapeHtml } from '../lib/templates.js';
import { stagePrefix } from '../lib/stage-prefix.js';
import { tenantsRepo } from '../repositories/tenants.repo.js';
import {
  enforceAdminRateLimit,
  extractClientIp,
  rateLimitHeaders,
} from '../middleware/rate-limit.middleware.js';

const ADMIN_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "frame-ancestors 'none'",
].join('; ');

const BRAND_BAR_CSS = `
.bb-bar { background: linear-gradient(180deg, #0f1624 0%, #0b1019 100%); border-bottom: 1px solid rgba(255,255,255,0.08); padding: 14px 24px; display: flex; align-items: center; gap: 14px; margin: calc(-1 * var(--sp-8)) calc(-1 * var(--sp-4)) var(--sp-6); }
@media (max-width: 960px) { .bb-bar { margin: -16px -16px 16px; padding: 12px 16px; } }
.bb-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.bb-dot { width: 10px; height: 10px; border-radius: 50%; background: linear-gradient(135deg, #14F195 0%, #23E5DB 50%, #0052FF 100%); box-shadow: 0 0 12px rgba(20,241,149,0.5); }
.bb-name { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; background: linear-gradient(90deg, #fff 0%, #cfd8e8 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.bb-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.12); }
.bb-section { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-dim); }
.bb-spacer { flex: 1; }
.bb-nav { display: flex; gap: 4px; }
.bb-nav a { padding: 6px 12px; border-radius: var(--radius-sm); font-size: var(--text-xs); color: var(--ink-dim); text-decoration: none; transition: background 0.1s, color 0.1s; }
.bb-nav a:hover { background: rgba(255,255,255,0.06); color: var(--ink); }
.bb-nav a.active { background: rgba(255,255,255,0.1); color: var(--ink); }
`;

function brandBar(active, event) {
  const base = stagePrefix(event);
  const item = (href, label, key) =>
    `<a href="${base}${href}"${key === active ? ' class="active"' : ''}>${label}</a>`;
  return `<div class="bb-bar">
  <a href="${base}/admin/tenants/ui" class="bb-brand">
    <span class="bb-dot"></span>
    <span class="bb-name">BitBooth</span>
  </a>
  <div class="bb-divider"></div>
  <div class="bb-section">Admin Console</div>
  <div class="bb-spacer"></div>
  <nav class="bb-nav">
    ${item('/admin/tenants/ui', 'Tenants', 'tenants')}
    ${item('/admin/metrics/ui', 'Metrics', 'metrics')}
    ${item('/admin/earnings', 'Earnings', 'earnings')}
    ${item('/admin/change-password', 'Password', 'password')}
    <a href="${base}/admin/logout">Logout</a>
  </nav>
</div>`;
}

function htmlResponse(status, body) {
  return {
    statusCode: status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': ADMIN_CSP,
      'x-content-type-options': 'nosniff',
    },
    body,
  };
}

function renderAdminLoginPage({ error, event } = {}) {
  const base = stagePrefix(event);
  const errorBlock = error ? `<div class="alert error">${escapeHtml(error)}</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BitBooth — Admin</title>
<style>${THEME_CSS}
body { background: radial-gradient(ellipse at top, #0f1624 0%, #080b12 50%, #05070b 100%); min-height: 100vh; }
.admin-wrap { max-width: 440px; margin: 0 auto; padding: 10vh var(--sp-4) var(--sp-8); }
.brand-block { display: flex; flex-direction: column; align-items: center; margin-bottom: var(--sp-8); }
.brand-logo { display: flex; align-items: center; gap: 12px; margin-bottom: var(--sp-3); }
.brand-dot {
  width: 14px; height: 14px; border-radius: 50%;
  background: linear-gradient(135deg, #14F195 0%, #23E5DB 50%, #0052FF 100%);
  box-shadow: 0 0 24px rgba(20,241,149,0.4), 0 0 48px rgba(20,241,149,0.15);
  animation: glow 3s ease-in-out infinite;
}
@keyframes glow { 0%,100% { box-shadow: 0 0 24px rgba(20,241,149,0.4), 0 0 48px rgba(20,241,149,0.15); } 50% { box-shadow: 0 0 28px rgba(35,229,219,0.5), 0 0 56px rgba(35,229,219,0.2); } }
.brand-name { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; background: linear-gradient(90deg, #fff 0%, #cfd8e8 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.brand-sub { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: 0.25em; text-transform: uppercase; color: var(--ink-dim); }
.admin-title { font-size: var(--text-xl); font-weight: 600; margin-bottom: var(--sp-2); text-align: center; }
.admin-sub { color: var(--ink-dim); font-size: var(--text-sm); margin-bottom: var(--sp-6); text-align: center; }
.form-group { margin-bottom: var(--sp-5); }
.form-group label { margin-bottom: var(--sp-2); display: block; font-size: var(--text-sm); color: var(--ink-dim); }
.login-btn { width: 100%; margin-top: var(--sp-2); padding: 12px 16px; font-weight: 600; }
.pw-wrap { position: relative; }
.pw-wrap input { padding-right: 64px; width: 100%; }
.pw-toggle {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  background: transparent; border: 1px solid var(--line); color: var(--ink-dim);
  font-size: var(--text-xs); font-family: inherit; cursor: pointer;
  padding: 4px 10px; border-radius: var(--radius-sm);
  transition: background 0.1s, color 0.1s;
}
.pw-toggle:hover { background: rgba(255,255,255,0.08); color: var(--ink); }
.pw-toggle:focus { outline: 1px solid var(--brand); outline-offset: 1px; }
.login-footer { text-align: center; margin-top: var(--sp-6); font-size: var(--text-xs); color: var(--ink-dim); font-family: 'JetBrains Mono', ui-monospace, monospace; }
.login-footer a { color: var(--ink-dim); text-decoration: none; }
.login-footer a:hover { color: var(--ink); }
.card { backdrop-filter: blur(12px); background: rgba(17,22,35,0.6); border: 1px solid rgba(255,255,255,0.08); }
</style>
</head>
<body>
<div class="admin-wrap">
  <div class="brand-block">
    <div class="brand-logo">
      <span class="brand-dot"></span>
      <span class="brand-name">BitBooth</span>
    </div>
    <div class="brand-sub">Agent Payment Gateway</div>
  </div>
  <div class="admin-title">Admin Access</div>
  <p class="admin-sub">Sign in with your admin key to continue</p>
  ${errorBlock}
  <div class="card">
    <form method="POST" action="${base}/admin/login">
      <div class="form-group">
        <label for="password">Admin Key</label>
        <div class="pw-wrap">
          <input type="password" id="password" name="password" required placeholder="Enter admin key" autocomplete="current-password">
          <button type="button" class="pw-toggle" id="pw-toggle" aria-label="Show password">Show</button>
        </div>
      </div>
      <button type="submit" class="btn btn-primary login-btn">Sign In</button>
    </form>
  </div>
  <div class="login-footer">x402 V2 · Built on <a href="https://x402.gitbook.io" target="_blank" rel="noopener">x402 protocol</a></div>
</div>
<script>
(function() {
  var btn = document.getElementById('pw-toggle');
  var input = document.getElementById('password');
  if (!btn || !input) return;
  btn.addEventListener('click', function() {
    var showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.textContent = showing ? 'Show' : 'Hide';
    btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    input.focus();
  });
})();
</script>
</body>
</html>`;
}

export async function getAdmin(event) {
  return htmlResponse(200, renderAdminLoginPage({ event }));
}

export async function postAdminLogin(event) {
  const clientIp = extractClientIp(event);
  await enforceAdminRateLimit(clientIp);

  const raw = event.body ?? '';
  const params = new URLSearchParams(raw);
  const parsed = AdminLoginBody.safeParse({
    password: params.get('password') ?? '',
  });

  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues);
  }

  await adminService.verifyAdminKey(parsed.data.password);
  const cookie = await adminService.createSessionCookie();

  await adminService.auditLog('login', { ip: clientIp });

  return {
    statusCode: 303,
    headers: {
      location: `${stagePrefix(event)}/admin/tenants/ui`,
      'set-cookie': cookie.options,
      'cache-control': 'no-store',
    },
    body: '',
  };
}

export async function getAdminLogout(event) {
  const cookieHeader = event?.headers?.cookie || event?.headers?.Cookie || '';
  try {
    await adminService.validateSession(cookieHeader);
    await adminService.auditLog('logout', {});
  } catch {
    // Clearing cookie even if session is invalid/expired
  }

  return {
    statusCode: 303,
    headers: {
      location: `${stagePrefix(event)}/admin`,
      'set-cookie': adminService.clearCookie(),
      'cache-control': 'no-store',
    },
    body: '',
  };
}

function renderStatusBadge(status) {
  const s = status ?? 'active';
  const cls = s === 'active' ? 'confirmed' : 'error-badge';
  return `<span class="badge ${cls}">${escapeHtml(s)}</span>`;
}

function renderTenantsTable(tenants, nextCursor, plan, revenueStats, event) {
  const base = stagePrefix(event);
  const filterOptions = ['', 'free', 'starter', 'growth', 'scale']
    .map(
      (p) =>
        `<option value="${p}"${p === (plan ?? '') ? ' selected' : ''}>${p || 'All plans'}</option>`,
    )
    .join('');

  const rows = tenants
    .map(
      (t) => `<tr>
    <td><code>${escapeHtml(t.accountId)}</code></td>
    <td>${escapeHtml(t.plan)}</td>
    <td>${renderStatusBadge(t.status)}</td>
    <td>${escapeHtml(t.createdAt ?? '')}</td>
    <td>
      ${
        (t.status ?? 'active') === 'active'
          ? `<form method="POST" action="${base}/admin/tenants/${encodeURIComponent(t.accountId)}/suspend" style="display:inline"><button type="submit" class="btn btn-sm btn-danger">Suspend</button></form>`
          : `<form method="POST" action="${base}/admin/tenants/${encodeURIComponent(t.accountId)}/reactivate" style="display:inline"><button type="submit" class="btn btn-sm btn-success">Reactivate</button></form>`
      }
    </td>
  </tr>`,
    )
    .join('');

  const pagination = nextCursor
    ? `<a href="${base}/admin/tenants/ui?cursor=${encodeURIComponent(nextCursor)}${plan ? '&plan=' + encodeURIComponent(plan) : ''}" class="btn btn-ghost">Next &rarr;</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BitBooth — Admin Tenants</title>
<style>${THEME_CSS}
${BRAND_BAR_CSS}
.admin-wrap { max-width: 1100px; margin: var(--sp-8) auto; padding: 0 var(--sp-4); }
.admin-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--sp-6); }
.admin-title { font-size: var(--text-2xl); font-weight: 700; }
.filter-form { display: flex; gap: var(--sp-3); align-items: center; }
.filter-form select { padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-md); border: 1px solid var(--line); background: rgba(0,0,0,0.3); color: var(--ink); font-size: var(--text-sm); font-family: inherit; }
.btn-sm { padding: var(--sp-1) var(--sp-3); font-size: var(--text-xs); }
.btn-danger { background: var(--error); color: #fff; border-color: var(--error); }
.btn-danger:hover { filter: brightness(1.1); }
.btn-success { background: var(--success); color: #fff; border-color: var(--success); }
.btn-success:hover { filter: brightness(1.1); }
.pagination { margin-top: var(--sp-4); text-align: right; }
.error-badge { background: rgba(239, 68, 68, 0.15); color: var(--error); }
.top-bar-right { display: flex; gap: var(--sp-3); align-items: center; }
.stats-bar { display: flex; gap: var(--sp-4); margin-bottom: var(--sp-6); }
.stat-pill { flex: 1; padding: var(--sp-4); border-radius: var(--radius-md); background: var(--surface); border: 1px solid var(--line); text-align: center; }
.stat-pill .stat-value { font-size: var(--text-2xl); font-weight: 700; color: var(--brand); }
.stat-pill .stat-label { font-size: var(--text-xs); color: var(--ink-dim); margin-top: var(--sp-1); }
</style>
</head>
<body>
<div class="admin-wrap">
  ${brandBar('tenants', event)}
  <div class="admin-header">
    <div class="admin-title">Tenants</div>
    <div class="top-bar-right">
      <form method="GET" action="${base}/admin/tenants/ui" class="filter-form">
        <select name="plan" onchange="this.form.submit()">
          ${filterOptions}
        </select>
      </form>
    </div>
  </div>
  <div class="stats-bar">
    <div class="stat-pill"><div class="stat-value">$${revenueStats?.mrr ?? 0}</div><div class="stat-label">MRR</div></div>
    <div class="stat-pill"><div class="stat-value">${revenueStats?.payingCount ?? 0}</div><div class="stat-label">Paying Tenants</div></div>
  </div>
  <div class="card">
    <table>
      <thead><tr><th>Account ID</th><th>Plan</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">No tenants found</td></tr>'}</tbody>
    </table>
  </div>
  <div class="pagination">${pagination}</div>
</div>
</body>
</html>`;
}

export async function listTenantsUI(event) {
  const clientIp = extractClientIp(event);
  await enforceAdminRateLimit(clientIp);

  const cookieHeader = event?.headers?.cookie || event?.headers?.Cookie || '';
  const session = await adminService.validateSession(cookieHeader);

  const parsed = AdminTenantsUIQuery.safeParse(event.queryStringParameters ?? {});
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues);
  }

  const { limit, cursor, plan } = parsed.data;
  const [result, revenueStats] = await Promise.all([
    adminService.listTenants({ limit, cursor, plan }),
    adminService.getRevenueStats(),
  ]);

  await adminService.auditLog('listTenantsUI', { limit, plan: plan ?? null });

  const html = renderTenantsTable(result.tenants, result.nextCursor, plan, revenueStats, event);
  const res = htmlResponse(200, html);
  if (session.refreshCookie) {
    res.headers['set-cookie'] = session.refreshCookie;
  }
  return res;
}

export async function suspendTenant(event) {
  const clientIp = extractClientIp(event);
  await enforceAdminRateLimit(clientIp);

  const cookieHeader = event?.headers?.cookie || event?.headers?.Cookie || '';
  await adminService.validateSession(cookieHeader);

  const accountId = event.pathParameters?.id;
  if (!accountId) throw new ValidationError([{ message: 'Missing tenant ID' }]);

  await tenantsRepo.updateStatus(accountId, 'suspended');
  await adminService.auditLog('suspendTenant', { accountId });

  return {
    statusCode: 303,
    headers: { location: `${stagePrefix(event)}/admin/tenants/ui`, 'cache-control': 'no-store' },
    body: '',
  };
}

export async function reactivateTenant(event) {
  const clientIp = extractClientIp(event);
  await enforceAdminRateLimit(clientIp);

  const cookieHeader = event?.headers?.cookie || event?.headers?.Cookie || '';
  await adminService.validateSession(cookieHeader);

  const accountId = event.pathParameters?.id;
  if (!accountId) throw new ValidationError([{ message: 'Missing tenant ID' }]);

  await tenantsRepo.updateStatus(accountId, 'active');
  await adminService.auditLog('reactivateTenant', { accountId });

  return {
    statusCode: 303,
    headers: { location: `${stagePrefix(event)}/admin/tenants/ui`, 'cache-control': 'no-store' },
    body: '',
  };
}

function renderMetricsDashboard(m, event) {
  const tenantRows = m.topTenants.length
    ? m.topTenants
        .map(
          (t, i) =>
            `<tr><td>${i + 1}</td><td><code>${escapeHtml(t.accountId)}</code></td><td>${t.paymentCount}</td><td>${(t.totalUsdcMicro / 1e6).toFixed(4)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="muted">No payments yet</td></tr>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BitBooth — Admin Metrics</title>
<style>${THEME_CSS}
${BRAND_BAR_CSS}
.admin-wrap { max-width: 1100px; margin: var(--sp-8) auto; padding: 0 var(--sp-4); }
.admin-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--sp-6); }
.admin-title { font-size: var(--text-2xl); font-weight: 700; }
.metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--sp-4); margin-bottom: var(--sp-6); }
.metric-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-xl); padding: var(--sp-4); text-align: center; }
.metric-value { font-size: var(--text-2xl); font-weight: 700; color: var(--accent); }
.metric-label { font-size: var(--text-xs); color: var(--ink-dim); margin-top: var(--sp-1); }
.fraud-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-3); margin-top: var(--sp-3); }
.fraud-pill { padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-md); background: rgba(239, 68, 68, 0.1); color: var(--error); text-align: center; font-size: var(--text-sm); }
.fraud-pill .pill-val { font-size: var(--text-xl); font-weight: 700; display: block; }
.top-bar-right { display: flex; gap: var(--sp-3); align-items: center; }
.nav-link { color: var(--ink-dim); text-decoration: none; font-size: var(--text-sm); }
.nav-link:hover { color: var(--ink); }
</style>
</head>
<body>
<div class="admin-wrap">
  ${brandBar('metrics', event)}
  <div class="admin-header">
    <div class="admin-title">Metrics Dashboard</div>
  </div>
  <div class="metrics-grid">
    <div class="metric-card"><div class="metric-value">$${m.mrr}</div><div class="metric-label">MRR</div></div>
    <div class="metric-card"><div class="metric-value">${m.payingCount}</div><div class="metric-label">Paying Tenants</div></div>
    <div class="metric-card"><div class="metric-value">${m.total402s}</div><div class="metric-label">402s Issued</div></div>
    <div class="metric-card"><div class="metric-value">${m.totalUsdc.toFixed(4)}</div><div class="metric-label">USDC Settled</div></div>
    <div class="metric-card"><div class="metric-value">${m.fetchesTotal}</div><div class="metric-label">Fetches Total</div></div>
    <div class="metric-card"><div class="metric-value">$${m.fetchRevenueUsdc.toFixed(4)}</div><div class="metric-label">Fetch Revenue</div></div>
  </div>
  <div class="card" style="margin-bottom:var(--sp-6)">
    <h3 style="margin-bottom:var(--sp-2)">Fraud Events</h3>
    <div class="fraud-grid">
      <div class="fraud-pill"><span class="pill-val">${m.fraudCounts.h24}</span>24h</div>
      <div class="fraud-pill"><span class="pill-val">${m.fraudCounts.h7d}</span>7d</div>
      <div class="fraud-pill"><span class="pill-val">${m.fraudCounts.h30d}</span>30d</div>
    </div>
  </div>
  <div class="card">
    <h3 style="margin-bottom:var(--sp-2)">Top 10 Tenants by Volume</h3>
    <table>
      <thead><tr><th>#</th><th>Account ID</th><th>Payments</th><th>USDC</th></tr></thead>
      <tbody>${tenantRows}</tbody>
    </table>
  </div>
</div>
</body>
</html>`;
}

export async function getAdminMetricsUI(event) {
  const clientIp = extractClientIp(event);
  await enforceAdminRateLimit(clientIp);

  const cookieHeader = event?.headers?.cookie || event?.headers?.Cookie || '';
  const session = await adminService.validateSession(cookieHeader);

  const metrics = await metricsService.getDashboard();

  await adminService.auditLog('viewMetrics', {});

  const res = htmlResponse(200, renderMetricsDashboard(metrics, event));
  if (session.refreshCookie) {
    res.headers['set-cookie'] = session.refreshCookie;
  }
  return res;
}

export async function listTenants(event) {
  const clientIp = extractClientIp(event);
  const rlInfo = await enforceAdminRateLimit(clientIp);

  const cookieHeader = event?.headers?.cookie || event?.headers?.Cookie || '';
  const session = await adminService.validateSession(cookieHeader);

  const parsed = AdminTenantsQuery.safeParse(event.queryStringParameters ?? {});
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues);
  }

  const { limit, cursor, plan } = parsed.data;
  const result = await adminService.listTenants({ limit, cursor, plan });

  await adminService.auditLog('listTenants', { limit, plan: plan ?? null });

  const res = jsonResponse(200, {
    tenants: result.tenants,
    nextCursor: result.nextCursor,
  });
  res.headers = {
    ...res.headers,
    ...rateLimitHeaders(rlInfo),
    ...(session.refreshCookie ? { 'set-cookie': session.refreshCookie } : {}),
  };
  return res;
}

function renderChangePasswordPage({ error, success, event } = {}) {
  const base = stagePrefix(event);
  const msg = error
    ? `<div class="alert error">${escapeHtml(error)}</div>`
    : success
      ? `<div class="alert success">${escapeHtml(success)}</div>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x402 — Change Admin Password</title>
<style>${THEME_CSS}
${BRAND_BAR_CSS}
.admin-wrap { max-width: 1100px; margin: var(--sp-8) auto 0; padding: 0 var(--sp-4); }
.pw-card-wrap { max-width: 480px; margin: var(--sp-8) auto 0; }
.admin-title { font-size: var(--text-2xl); font-weight: 700; margin-bottom: var(--sp-2); }
.admin-sub { color: var(--ink-dim); font-size: var(--text-sm); margin-bottom: var(--sp-6); }
.form-group { margin-bottom: var(--sp-4); }
.form-group label { display: block; margin-bottom: var(--sp-2); font-size: var(--text-sm); }
.hint { color: var(--ink-dim); font-size: var(--text-xs); margin-top: var(--sp-1); }
.submit-btn { width: 100%; margin-top: var(--sp-3); }
.pw-wrap { position: relative; }
.pw-wrap input { padding-right: 56px; width: 100%; }
.pw-toggle {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  background: transparent; border: 1px solid var(--line); color: var(--ink-dim);
  font-size: var(--text-xs); font-family: inherit; cursor: pointer;
  padding: 4px 10px; border-radius: var(--radius-sm);
}
.pw-toggle:hover { background: rgba(255,255,255,0.08); color: var(--ink); }
.back-link { display: inline-block; margin-top: var(--sp-4); color: var(--ink-dim); text-decoration: none; font-size: var(--text-sm); }
.back-link:hover { color: var(--ink); }
.alert.success { background: rgba(34,197,94,0.1); color: var(--success); border: 1px solid rgba(34,197,94,0.3); padding: var(--sp-3); border-radius: var(--radius-md); margin-bottom: var(--sp-4); }
</style>
</head>
<body>
<div class="admin-wrap">
  ${brandBar('password', event)}
</div>
<div class="pw-card-wrap">
  <div class="admin-title">Change Admin Password</div>
  <p class="admin-sub">Rotate the admin key used to sign into /admin.</p>
  ${msg}
  <div class="card">
    <form method="POST" action="${base}/admin/change-password">
      <div class="form-group">
        <label for="current">Current Password</label>
        <div class="pw-wrap">
          <input type="password" id="current" name="currentPassword" required autocomplete="current-password">
          <button type="button" class="pw-toggle" data-for="current">Show</button>
        </div>
      </div>
      <div class="form-group">
        <label for="newpw">New Password</label>
        <div class="pw-wrap">
          <input type="password" id="newpw" name="newPassword" required minlength="12" autocomplete="new-password">
          <button type="button" class="pw-toggle" data-for="newpw">Show</button>
        </div>
        <div class="hint">Minimum 12 characters.</div>
      </div>
      <div class="form-group">
        <label for="confirm">Confirm New Password</label>
        <div class="pw-wrap">
          <input type="password" id="confirm" name="confirmPassword" required minlength="12" autocomplete="new-password">
          <button type="button" class="pw-toggle" data-for="confirm">Show</button>
        </div>
      </div>
      <button type="submit" class="btn btn-primary submit-btn">Update Password</button>
    </form>
  </div>
  <div style="text-align:center"><a href="${base}/admin/tenants/ui" class="back-link">&larr; Back to admin</a></div>
</div>
<script>
(function() {
  document.querySelectorAll('.pw-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var input = document.getElementById(btn.getAttribute('data-for'));
      if (!input) return;
      var showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
    });
  });
})();
</script>
</body>
</html>`;
}

export async function getAdminChangePassword(event) {
  const clientIp = extractClientIp(event);
  await enforceAdminRateLimit(clientIp);
  const cookieHeader = event?.headers?.cookie || event?.headers?.Cookie || '';
  await adminService.validateSession(cookieHeader);
  return htmlResponse(200, renderChangePasswordPage({ event }));
}

export async function postAdminChangePassword(event) {
  const clientIp = extractClientIp(event);
  await enforceAdminRateLimit(clientIp);
  const cookieHeader = event?.headers?.cookie || event?.headers?.Cookie || '';
  await adminService.validateSession(cookieHeader);

  const raw = event.body ?? '';
  const params = new URLSearchParams(raw);
  const parsed = AdminChangePasswordBody.safeParse({
    currentPassword: params.get('currentPassword') ?? '',
    newPassword: params.get('newPassword') ?? '',
    confirmPassword: params.get('confirmPassword') ?? '',
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || 'Invalid input';
    return htmlResponse(400, renderChangePasswordPage({ error: issue, event }));
  }

  try {
    await adminService.changeAdminKey(parsed.data.currentPassword, parsed.data.newPassword);
  } catch (e) {
    return htmlResponse(401, renderChangePasswordPage({ error: e?.message || 'Update failed', event }));
  }

  await adminService.auditLog('changePassword', { ip: clientIp });
  return htmlResponse(200, renderChangePasswordPage({ success: 'Password updated successfully. Use your new password next time you sign in.', event }));
}
