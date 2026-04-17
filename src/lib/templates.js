/**
 * HTML template for the local dev dashboard.
 * Extracted from local-server.js to keep both files under 300 lines.
 */

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render the Lambda-served dashboard page (no demo banner, no stats).
 * @param {object} opts
 * @param {object}  [opts.signupResult]
 * @param {Array}   [opts.payments]
 * @param {string}  [opts.error]
 */
export function renderPage({ signupResult, payments, error }) {
  const signupSection = signupResult
    ? `<div class="alert success">
        <strong>Account created!</strong><br>
        Account ID: <code>${escapeHtml(signupResult.accountId)}</code><br>
        API Key: <code>${escapeHtml(signupResult.apiKey)}</code><br>
        <em>Save this key now — it will not be shown again.</em>
      </div>`
    : '';

  const errorSection = error ? `<div class="alert error">${escapeHtml(error)}</div>` : '';

  const paymentRows = (payments ?? [])
    .map(
      (p) => `<tr>
      <td>${escapeHtml(p.idempotencyKey ?? '')}</td>
      <td>${escapeHtml(p.amountWei ?? '')}</td>
      <td>${escapeHtml(p.assetSymbol ?? '')}</td>
      <td>${escapeHtml(p.status ?? '')}</td>
      <td><code>${escapeHtml(p.txHash ?? '')}</code></td>
      <td>${escapeHtml(p.createdAt ?? '')}</td>
    </tr>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x402 Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;max-width:900px;margin:0 auto;padding:2rem;background:#fafafa;color:#1a1a1a}
  h1{margin-bottom:.5rem} h2{margin:2rem 0 1rem}
  .alert{padding:1rem;border-radius:6px;margin:1rem 0}
  .success{background:#d4edda;border:1px solid #28a745}
  .error{background:#f8d7da;border:1px solid #dc3545}
  form{margin:1rem 0}
  button{padding:.6rem 1.2rem;background:#0066cc;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:1rem}
  button:hover{background:#0052a3}
  table{width:100%;border-collapse:collapse;margin:1rem 0}
  th,td{text-align:left;padding:.5rem;border-bottom:1px solid #ddd}
  th{background:#eee}
  code{background:#e9ecef;padding:2px 4px;border-radius:3px;font-size:.85em;word-break:break-all}
  .muted{color:#666;font-size:.9em}
</style>
</head>
<body>
  <h1>x402 Dashboard</h1>
  <p class="muted">Manage your account and view payment activity.</p>

  <h2>Create Account</h2>
  <form method="POST" action="/dashboard/signup">
    <button type="submit">Sign Up (Free Tier)</button>
  </form>
  ${signupSection}
  ${errorSection}

  <h2>Recent Payments</h2>
  <p class="muted">Enter your account ID to view payments.</p>
  <form method="GET" action="/dashboard">
    <input name="accountId" placeholder="Account ID (UUID)" style="padding:.5rem;width:320px;border:1px solid #ccc;border-radius:4px">
    <button type="submit">Look Up</button>
  </form>
  ${
    payments
      ? `<table>
    <thead><tr><th>Nonce</th><th>Amount (wei)</th><th>Asset</th><th>Status</th><th>Tx Hash</th><th>Date</th></tr></thead>
    <tbody>${paymentRows || '<tr><td colspan="6" class="muted">No payments found.</td></tr>'}</tbody>
  </table>`
      : ''
  }
</body>
</html>`;
}

/**
 * Render the local-dev dashboard (with demo banner and stats).
 * @param {object} opts
 * @param {object}  [opts.signupResult]
 * @param {Array}   [opts.paymentList]
 * @param {string}  [opts.error]
 * @param {Array}   [opts.tenantRoutes]
 * @param {object}  [opts.tenant]
 * @param {{ id: string, key: string }} opts.demo
 * @param {{ tenants: number, payments: number, routes: number }} opts.stats
 */
export function renderDashboard({
  signupResult,
  paymentList,
  error,
  tenantRoutes,
  tenant,
  demo,
  stats,
}) {
  const signupSection = signupResult
    ? `<div class="alert success">
        <strong>Account created!</strong><br>
        Account ID: <code>${escapeHtml(signupResult.accountId)}</code><br>
        API Key: <code>${escapeHtml(signupResult.apiKey)}</code><br>
        Plan: <code>${escapeHtml(signupResult.plan)}</code><br>
        <em>Save this key now — it will not be shown again.</em>
      </div>`
    : '';

  const errorSection = error ? `<div class="alert error">${escapeHtml(error)}</div>` : '';

  const paymentRows = (paymentList ?? [])
    .map(
      (p) => `<tr>
    <td>${escapeHtml(p.idempotencyKey ?? '')}</td>
    <td>${escapeHtml(p.amountWei ?? '')}</td>
    <td>${escapeHtml(p.assetSymbol ?? '')}</td>
    <td><span class="badge ${p.status}">${escapeHtml(p.status ?? '')}</span></td>
    <td><code>${escapeHtml((p.txHash ?? '').slice(0, 18))}...</code></td>
    <td>${escapeHtml(p.createdAt ?? '')}</td>
  </tr>`,
    )
    .join('\n');

  const routeRows = (tenantRoutes ?? [])
    .map(
      (r) => `<tr>
    <td><code>${escapeHtml(r.path)}</code></td>
    <td>${escapeHtml(r.priceWei ?? '0')} wei</td>
    <td>${escapeHtml(r.asset ?? 'USDC')}</td>
    <td>${escapeHtml(r.createdAt ?? '')}</td>
  </tr>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x402 — Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',system-ui,sans-serif;background:#0b0b1a;color:#f0f0f8;min-height:100vh}
  .container{max-width:960px;margin:0 auto;padding:2rem}
  .header{display:flex;align-items:center;gap:12px;margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:1px solid rgba(139,92,246,0.15)}
  .logo{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#a78bfa);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:white}
  .header h1{font-size:22px;font-weight:700;background:linear-gradient(135deg,#7c3aed,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .header span{color:#5a5a80;font-size:13px;margin-left:6px;font-weight:400}
  h2{font-size:16px;font-weight:600;margin:2rem 0 1rem;color:#a78bfa}
  .card{background:#13132b;border:1px solid rgba(139,92,246,0.12);border-radius:16px;padding:24px;margin-bottom:20px}
  .alert{padding:1rem;border-radius:10px;margin:1rem 0;font-size:14px}
  .success{background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);color:#22c55e}
  .error{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#ef4444}
  form{margin:1rem 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  input{font-family:'Inter',sans-serif;font-size:13px;padding:10px 14px;border:1px solid rgba(139,92,246,0.15);border-radius:10px;background:#0b0b1a;color:#f0f0f8;outline:none;width:320px}
  input:focus{border-color:#8b5cf6}
  button{font-family:'Inter',sans-serif;font-size:13px;font-weight:600;padding:10px 20px;border:none;border-radius:10px;cursor:pointer;transition:all 0.2s;background:linear-gradient(135deg,#7c3aed,#a78bfa);color:white;box-shadow:0 2px 12px rgba(139,92,246,0.3)}
  button:hover{box-shadow:0 4px 20px rgba(139,92,246,0.4)}
  button.secondary{background:#1a1a3e;border:1px solid rgba(139,92,246,0.2);color:#a0a0c0;box-shadow:none}
  table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:13px}
  th{text-align:left;padding:10px 12px;color:#5a5a80;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(139,92,246,0.1)}
  td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.03);color:#a0a0c0}
  code{background:rgba(139,92,246,0.08);padding:2px 6px;border-radius:4px;font-size:12px;color:#a78bfa}
  .badge{font-size:11px;font-weight:600;padding:2px 10px;border-radius:6px}
  .badge.confirmed{background:rgba(34,197,94,0.15);color:#22c55e}
  .badge.pending{background:rgba(234,179,8,0.15);color:#eab308}
  .muted{color:#5a5a80;font-size:13px}
  .demo-banner{background:linear-gradient(135deg,rgba(139,92,246,0.08),rgba(59,130,246,0.06));border:1px solid rgba(139,92,246,0.15);border-radius:12px;padding:16px;margin-bottom:20px;font-size:13px;color:#a78bfa}
  .demo-banner code{font-size:11px}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}
  .stat{background:#13132b;border:1px solid rgba(139,92,246,0.12);border-radius:12px;padding:16px;text-align:center}
  .stat .value{font-size:28px;font-weight:800;color:#a78bfa}
  .stat .label{font-size:11px;color:#5a5a80;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo">402</div>
    <h1>x402 <span>dashboard</span></h1>
  </div>

  <div class="demo-banner">
    Demo mode — in-memory storage, no AWS required.<br>
    Pre-seeded tenant: <code>${escapeHtml(demo.id)}</code> &middot; API Key: <code>${escapeHtml(demo.key)}</code>
  </div>

  <div class="stats">
    <div class="stat"><div class="value">${stats.tenants}</div><div class="label">Tenants</div></div>
    <div class="stat"><div class="value">${stats.payments}</div><div class="label">Payments</div></div>
    <div class="stat"><div class="value">${stats.routes}</div><div class="label">Routes</div></div>
  </div>

  ${signupSection}${errorSection}

  <div class="card">
    <h2>Create Account</h2>
    <form method="POST" action="/dashboard/signup">
      <button type="submit">Sign Up (Free Tier)</button>
    </form>
  </div>

  <div class="card">
    <h2>Recent Payments</h2>
    <p class="muted">Enter your account ID to view payments.</p>
    <form method="GET" action="/dashboard">
      <input name="accountId" placeholder="Account ID (UUID)" value="${escapeHtml(tenant?.accountId ?? '')}">
      <button type="submit" class="secondary">Look Up</button>
    </form>
    ${
      paymentList
        ? `<table>
      <thead><tr><th>Nonce</th><th>Amount</th><th>Asset</th><th>Status</th><th>Tx Hash</th><th>Date</th></tr></thead>
      <tbody>${paymentRows || '<tr><td colspan="6" class="muted">No payments found.</td></tr>'}</tbody>
    </table>`
        : ''
    }
  </div>

  <div class="card">
    <h2>Routes</h2>
    <p class="muted">Routes configured for this tenant.</p>
    ${
      tenantRoutes && tenantRoutes.length
        ? `<table>
      <thead><tr><th>Path</th><th>Price</th><th>Asset</th><th>Created</th></tr></thead>
      <tbody>${routeRows}</tbody>
    </table>`
        : '<p class="muted" style="margin-top:12px">No routes configured yet.</p>'
    }
  </div>
</div>
</body>
</html>`;
}
