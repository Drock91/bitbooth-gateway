import { THEME_CSS } from '../static/theme.css.js';
import { stagePrefix } from '../lib/stage-prefix.js';

export const ADMIN_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "frame-ancestors 'none'",
].join('; ');

export const BRAND_BAR_CSS = `
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

export function brandBar(active, event) {
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

export function htmlResponse(status, body) {
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

export { THEME_CSS };
