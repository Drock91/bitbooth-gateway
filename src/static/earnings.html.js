// Grafana-style earnings dashboard. Fetches /admin/earnings.json on load
// and every 30s. Uses Chart.js from jsdelivr (pinned) for the sparkline.

export function renderEarningsPage(basePath = '') {
  const base = basePath || '';
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BitBooth Earnings</title>
<style>
:root {
  --bg:#0b0f17; --bg2:#111826; --panel:#161e2e; --panel2:#1a2336;
  --border:#1f2937; --border2:#2a3445;
  --ink:#e6edf7; --ink-dim:#94a3b8; --ink-mute:#64748b;
  --accent:#14f195; --accent2:#9945ff; --danger:#ef4444; --warn:#f59e0b;
  --mono:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;
  --sans:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);min-height:100vh;font-size:14px;line-height:1.5}
.shell{display:grid;grid-template-rows:auto 1fr;min-height:100vh}
.topbar{display:flex;align-items:center;gap:16px;padding:12px 20px;background:var(--bg2);border-bottom:1px solid var(--border)}
.brand{font-weight:700;font-size:16px;letter-spacing:-0.01em;display:flex;align-items:center;gap:8px}
.brand-dot{width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));box-shadow:0 0 12px rgba(20,241,149,0.5)}
.topbar .spacer{flex:1}
.status{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:12px;color:var(--ink-dim)}
.status-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.refresh{font-family:var(--mono);font-size:11px;color:var(--ink-mute)}
.adminnav{display:flex;gap:4px;margin-left:8px}
.adminnav a{padding:6px 12px;border-radius:4px;font-size:12px;color:var(--ink-dim);text-decoration:none;font-family:var(--sans);transition:background 0.1s,color 0.1s}
.adminnav a:hover{background:var(--panel2);color:var(--ink)}
.adminnav a.active{background:var(--panel);color:var(--accent);border:1px solid var(--border)}

.grid{padding:16px;display:grid;gap:12px;grid-template-columns:repeat(4,1fr)}
@media(max-width:1100px){.grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.grid{grid-template-columns:1fr}}

.panel{background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:14px 16px;position:relative}
.panel.span2{grid-column:span 2}
.panel.span4{grid-column:span 4}
@media(max-width:1100px){.panel.span4,.panel.span2{grid-column:span 2}}
@media(max-width:600px){.panel.span4,.panel.span2{grid-column:span 1}}

.panel-title{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--ink-dim);font-weight:500;margin-bottom:10px}
.kpi{font-family:var(--mono);font-size:28px;font-weight:700;letter-spacing:-0.02em}
.kpi-unit{font-size:13px;color:var(--ink-dim);font-weight:500;margin-left:4px}
.kpi-sub{font-family:var(--mono);font-size:11px;color:var(--ink-mute);margin-top:4px}

/* Sparkline */
.spark-wrap{height:180px;position:relative}

/* Chain + agent + resource lists */
.list{display:flex;flex-direction:column;gap:8px;max-height:360px;overflow-y:auto}
.row{display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--panel2);border-radius:4px;font-size:12px}
.row:hover{background:var(--border2)}
.row .dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.row .label{flex:1;font-family:var(--mono);color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .stat{font-family:var(--mono);color:var(--ink-dim);font-size:11px}
.row .stat-main{color:var(--ink);font-weight:600}

/* Recent payments table */
.table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px}
.table thead{background:var(--panel2)}
.table th{text-align:left;padding:8px 10px;font-weight:500;text-transform:uppercase;font-size:10px;letter-spacing:0.06em;color:var(--ink-dim);border-bottom:1px solid var(--border)}
.table td{padding:8px 10px;border-bottom:1px solid var(--border);color:var(--ink)}
.table tr:hover{background:var(--panel2)}
.table a{color:var(--accent);text-decoration:none}
.table a:hover{text-decoration:underline}
.pill{display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600;letter-spacing:0.04em;background:rgba(255,255,255,0.06)}

.loading{text-align:center;color:var(--ink-mute);padding:40px;font-family:var(--mono);font-size:12px}
.err{color:var(--danger);background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);padding:12px;border-radius:4px;font-family:var(--mono);font-size:12px}

.empty{color:var(--ink-mute);font-style:italic;text-align:center;padding:20px;font-size:12px;font-family:var(--mono)}
</style>
</head>
<body>
<div class="shell">
  <div class="topbar">
    <div class="brand"><span class="brand-dot"></span> BitBooth Earnings</div>
    <nav class="adminnav">
      <a href="${base}/admin/tenants/ui">Tenants</a>
      <a href="${base}/admin/metrics/ui">Metrics</a>
      <a href="${base}/admin/earnings" class="active">Earnings</a>
      <a href="${base}/admin/change-password">Password</a>
      <a href="${base}/admin/logout">Logout</a>
    </nav>
    <div class="spacer"></div>
    <div class="status"><span class="status-dot"></span> <span id="status-text">live</span></div>
    <div class="refresh" id="refresh-text">auto-refresh 30s</div>
  </div>

  <div class="grid" id="grid">
    <div class="panel span4 loading" id="loading">Loading earnings…</div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script>
const REFRESH_MS = 30_000;
let chart;

const CHAIN_UNIT = {
  'eip155:84532': 'USDC', 'eip155:8453': 'USDC', 'eip155:1440002': 'USDC',
  'xrpl:0': 'XRP', 'xrpl:1': 'XRP',
  'solana:mainnet': 'USDC', 'solana:devnet': 'USDC',
};

function fmtAmount(n, unit) {
  const decimals = unit === 'XRP' ? 6 : 4;
  return n.toFixed(decimals) + ' ' + (unit || 'USDC');
}
function fmtTimeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return Math.floor(ms / 1000) + 's ago';
  if (ms < 3_600_000) return Math.floor(ms / 60_000) + 'm ago';
  if (ms < 86_400_000) return Math.floor(ms / 3_600_000) + 'h ago';
  return Math.floor(ms / 86_400_000) + 'd ago';
}
function shortHash(h) { return h ? h.slice(0, 10) + '…' + h.slice(-6) : ''; }
function explorer(network, txHash) {
  if (network === 'eip155:84532') return 'https://sepolia.basescan.org/tx/' + txHash;
  if (network === 'eip155:8453') return 'https://basescan.org/tx/' + txHash;
  if (network === 'eip155:1440002') return 'https://explorer.testnet.xrplevm.org/tx/' + txHash;
  if (network === 'xrpl:0') return 'https://xrpscan.com/tx/' + txHash;
  if (network === 'xrpl:1') return 'https://testnet.xrpl.org/transactions/' + txHash;
  return '#';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderDashboard(data) {
  const grid = document.getElementById('grid');
  const t = data.totals;

  // Chain list rendering (skip if empty)
  const chainRows = data.byChain.length
    ? data.byChain.map(c => \`
      <div class="row">
        <span class="dot" style="background:\${c.color}"></span>
        <span class="label">\${escapeHtml(c.label)}</span>
        <span class="stat">\${c.count} pays</span>
        <span class="stat stat-main">\${fmtAmount(c.amount, c.unit)}</span>
      </div>\`).join('')
    : '<div class="empty">No chain data yet</div>';

  const agentRows = data.byAgent.length
    ? data.byAgent.map(a => \`
      <div class="row">
        <span class="dot" style="background:#9945ff"></span>
        <span class="label">\${escapeHtml(a.accountId)}</span>
        <span class="stat">\${a.count} calls</span>
      </div>\`).join('')
    : '<div class="empty">No agents yet</div>';

  const resourceRows = data.byResource.length
    ? data.byResource.map(r => \`
      <div class="row">
        <span class="dot" style="background:#14f195"></span>
        <span class="label">\${escapeHtml(r.resource)}</span>
        <span class="stat">\${r.count} calls</span>
      </div>\`).join('')
    : '<div class="empty">No resources yet</div>';

  const recentRows = data.recent.length
    ? data.recent.map(p => \`
      <tr>
        <td><span class="pill" style="background:\${p.chainColor}33;color:\${p.chainColor}">\${escapeHtml(p.chainLabel)}</span></td>
        <td>\${fmtAmount(p.amount, p.asset)}</td>
        <td title="\${escapeHtml(p.accountId)}">\${escapeHtml((p.accountId || '').slice(0, 24))}</td>
        <td>\${escapeHtml(p.resource)}</td>
        <td><a href="\${explorer(p.network, p.txHash)}" target="_blank" rel="noopener">\${shortHash(p.txHash)}</a></td>
        <td>\${fmtTimeAgo(p.confirmedAt)}</td>
      </tr>\`).join('')
    : '<tr><td colspan="6" class="empty">No payments yet — waiting for your first agent call</td></tr>';

  grid.innerHTML = \`
    <div class="panel">
      <div class="panel-title">Total Payments</div>
      <div class="kpi">\${t.payments.toLocaleString()}<span class="kpi-unit">all time</span></div>
      <div class="kpi-sub">\${t.uniqueAgents} unique agents</div>
    </div>
    <div class="panel">
      <div class="panel-title">Last 24 Hours</div>
      <div class="kpi">\${t.last24h.toFixed(4)}<span class="kpi-unit">units</span></div>
      <div class="kpi-sub">mixed across chains</div>
    </div>
    <div class="panel">
      <div class="panel-title">Last 7 Days</div>
      <div class="kpi">\${t.last7d.toFixed(4)}<span class="kpi-unit">units</span></div>
      <div class="kpi-sub">trending</div>
    </div>
    <div class="panel">
      <div class="panel-title">Last 30 Days</div>
      <div class="kpi">\${t.last30d.toFixed(4)}<span class="kpi-unit">units</span></div>
      <div class="kpi-sub">monthly</div>
    </div>

    <div class="panel span4">
      <div class="panel-title">Payments / Hour (last 24h)</div>
      <div class="spark-wrap"><canvas id="spark"></canvas></div>
    </div>

    <div class="panel span2">
      <div class="panel-title">Earnings by Chain</div>
      <div class="list">\${chainRows}</div>
    </div>
    <div class="panel span2">
      <div class="panel-title">Top Agents</div>
      <div class="list">\${agentRows}</div>
    </div>

    <div class="panel span4">
      <div class="panel-title">Recent Payments</div>
      <table class="table">
        <thead>
          <tr>
            <th>Chain</th>
            <th>Amount</th>
            <th>Agent</th>
            <th>Resource</th>
            <th>Tx</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>\${recentRows}</tbody>
      </table>
    </div>
  \`;

  // Render sparkline
  if (chart) chart.destroy();
  const ctx = document.getElementById('spark');
  const labels = data.sparkline.map(b => new Date(b.ts).getHours() + ':00');
  const counts = data.sparkline.map(b => b.count);
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Payments',
        data: counts,
        backgroundColor: 'rgba(20,241,149,0.5)',
        borderColor: '#14f195',
        borderWidth: 1,
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#1f2937' }, ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } } },
        y: { grid: { color: '#1f2937' }, ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 }, stepSize: 1 }, beginAtZero: true },
      },
    },
  });
}

async function refresh() {
  const statusEl = document.getElementById('status-text');
  try {
    statusEl.textContent = 'refreshing…';
    const r = await fetch('${base}/admin/earnings.json', { credentials: 'same-origin' });
    if (r.status === 401 || r.status === 403) {
      document.getElementById('grid').innerHTML =
        '<div class="panel span4 err">Session expired. <a href="${base}/admin" style="color:#14f195">Sign in</a> to continue.</div>';
      return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    renderDashboard(data);
    statusEl.textContent = 'live';
    document.getElementById('refresh-text').textContent = 'updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    statusEl.textContent = 'error';
    document.getElementById('grid').innerHTML =
      '<div class="panel span4 err">Failed to load: ' + escapeHtml(e.message) + '</div>';
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
</script>
</body>
</html>`;
}
