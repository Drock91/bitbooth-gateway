import { adminService } from '../services/admin.service.js';
import { metricsService } from '../services/metrics.service.js';
import { jsonResponse } from '../middleware/error.middleware.js';
import {
  AdminTenantsQuery,
  AdminTenantsUIQuery,
  AdminLoginBody,
} from '../validators/admin.schema.js';
import { ValidationError } from '../lib/errors.js';
import { THEME_CSS } from '../static/theme.css.js';
import { escapeHtml } from '../lib/templates.js';
import { tenantsRepo } from '../repositories/tenants.repo.js';
import {
  enforceAdminRateLimit,
  extractClientIp,
  rateLimitHeaders,
} from '../middleware/rate-limit.middleware.js';

const ADMIN_CSP = [
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
      'content-security-policy': ADMIN_CSP,
      'x-content-type-options': 'nosniff',
    },
    body,
  };
}

function renderAdminLoginPage({ error } = {}) {
  const errorBlock = error ? `<div class="alert error">${escapeHtml(error)}</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x402 — Admin</title>
<style>${THEME_CSS}
.admin-wrap { max-width: 420px; margin: var(--sp-16) auto; padding: 0 var(--sp-4); }
.admin-title { font-size: var(--text-2xl); font-weight: 700; margin-bottom: var(--sp-2); }
.admin-sub { color: var(--ink-dim); font-size: var(--text-sm); margin-bottom: var(--sp-8); }
.form-group { margin-bottom: var(--sp-5); }
.form-group label { margin-bottom: var(--sp-2); }
.login-btn { width: 100%; margin-top: var(--sp-2); }
</style>
</head>
<body>
<div class="admin-wrap">
  <div class="admin-title">x402 Admin</div>
  <p class="admin-sub">Sign in with your admin key</p>
  ${errorBlock}
  <div class="card">
    <form method="POST" action="/admin/login">
      <div class="form-group">
        <label for="password">Admin Key</label>
        <input type="password" id="password" name="password" required placeholder="Enter admin key">
      </div>
      <button type="submit" class="btn btn-primary login-btn">Sign In</button>
    </form>
  </div>
</div>
</body>
</html>`;
}

export async function getAdmin() {
  return htmlResponse(200, renderAdminLoginPage());
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
      location: '/admin/tenants',
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
      location: '/admin',
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

function renderTenantsTable(tenants, nextCursor, plan, revenueStats) {
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
          ? `<form method="POST" action="/admin/tenants/${encodeURIComponent(t.accountId)}/suspend" style="display:inline"><button type="submit" class="btn btn-sm btn-danger">Suspend</button></form>`
          : `<form method="POST" action="/admin/tenants/${encodeURIComponent(t.accountId)}/reactivate" style="display:inline"><button type="submit" class="btn btn-sm btn-success">Reactivate</button></form>`
      }
    </td>
  </tr>`,
    )
    .join('');

  const pagination = nextCursor
    ? `<a href="/admin/tenants/ui?cursor=${encodeURIComponent(nextCursor)}${plan ? '&plan=' + encodeURIComponent(plan) : ''}" class="btn btn-ghost">Next &rarr;</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x402 — Admin Tenants</title>
<style>${THEME_CSS}
.admin-wrap { max-width: 960px; margin: var(--sp-8) auto; padding: 0 var(--sp-4); }
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
  <div class="admin-header">
    <div class="admin-title">Tenants</div>
    <div class="top-bar-right">
      <form method="GET" action="/admin/tenants/ui" class="filter-form">
        <select name="plan" onchange="this.form.submit()">
          ${filterOptions}
        </select>
      </form>
      <a href="/admin/logout" class="btn btn-ghost btn-sm">Logout</a>
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

  const html = renderTenantsTable(result.tenants, result.nextCursor, plan, revenueStats);
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
    headers: { location: '/admin/tenants/ui', 'cache-control': 'no-store' },
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
    headers: { location: '/admin/tenants/ui', 'cache-control': 'no-store' },
    body: '',
  };
}

function renderMetricsDashboard(m) {
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
<title>x402 — Admin Metrics</title>
<style>${THEME_CSS}
.admin-wrap { max-width: 960px; margin: var(--sp-8) auto; padding: 0 var(--sp-4); }
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
  <div class="admin-header">
    <div class="admin-title">Metrics Dashboard</div>
    <div class="top-bar-right">
      <a href="/admin/tenants/ui" class="nav-link">Tenants</a>
      <a href="/admin/logout" class="btn btn-ghost btn-sm">Logout</a>
    </div>
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

  const res = htmlResponse(200, renderMetricsDashboard(metrics));
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
