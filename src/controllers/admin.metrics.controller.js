import { adminService } from '../services/admin.service.js';
import { metricsService } from '../services/metrics.service.js';
import { escapeHtml } from '../lib/templates.js';
import {
  enforceAdminRateLimit,
  extractClientIp,
} from '../middleware/rate-limit.middleware.js';
import { THEME_CSS, BRAND_BAR_CSS, brandBar, htmlResponse } from './admin.shared.js';

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
