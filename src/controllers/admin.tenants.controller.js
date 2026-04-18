import { adminService } from '../services/admin.service.js';
import { jsonResponse } from '../middleware/error.middleware.js';
import { AdminTenantsQuery, AdminTenantsUIQuery } from '../validators/admin.schema.js';
import { ValidationError } from '../lib/errors.js';
import { escapeHtml } from '../lib/templates.js';
import { stagePrefix } from '../lib/stage-prefix.js';
import { tenantsRepo } from '../repositories/tenants.repo.js';
import {
  enforceAdminRateLimit,
  extractClientIp,
  rateLimitHeaders,
} from '../middleware/rate-limit.middleware.js';
import { THEME_CSS, BRAND_BAR_CSS, brandBar, htmlResponse } from './admin.shared.js';

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
