import { THEME_CSS } from '../static/theme.css.js';
import { escapeHtml } from './templates.js';

const PORTAL_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "frame-ancestors 'none'",
].join('; ');

const INTEGRATE_CSS = `
.portal { max-width: 960px; margin: 0 auto; padding: var(--sp-6); }
.portal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--sp-6); padding-bottom: var(--sp-4); border-bottom: 1px solid var(--line); }
.portal-header h1 { font-size: var(--text-xl); font-weight: 700; }
.nav-links { display: flex; gap: var(--sp-4); align-items: center; }
.section-title { font-size: var(--text-lg); font-weight: 600; margin-bottom: var(--sp-3); }
.tabs { display: flex; gap: var(--sp-1); border-bottom: 1px solid var(--line); margin-bottom: var(--sp-4); }
.tab { padding: var(--sp-2) var(--sp-4); cursor: pointer; border: none; background: none; color: var(--ink-dim); font-size: var(--text-sm); font-family: var(--font-sans); border-bottom: 2px solid transparent; transition: color .15s, border-color .15s; }
.tab:hover { color: var(--ink); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-panel { display: none; }
.tab-panel.active { display: block; }
pre.code-block { background: rgba(0,0,0,0.3); border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--sp-4); overflow-x: auto; font-size: var(--text-sm); line-height: 1.6; }
pre.code-block code { color: var(--ink); font-family: var(--font-mono); }
.step { margin-bottom: var(--sp-6); }
.step-num { display: inline-block; width: 28px; height: 28px; line-height: 28px; text-align: center; border-radius: 50%; background: var(--accent); color: var(--accent-ink); font-weight: 700; font-size: var(--text-sm); margin-right: var(--sp-2); }
.step-title { font-weight: 600; font-size: var(--text-md); }
.step p { color: var(--ink-dim); margin-top: var(--sp-2); font-size: var(--text-sm); }
.note { background: rgba(124,241,160,0.06); border: 1px solid rgba(124,241,160,0.15); border-radius: var(--radius-md); padding: var(--sp-3) var(--sp-4); font-size: var(--text-sm); color: var(--ink-dim); margin-top: var(--sp-4); }
.note strong { color: var(--accent); }
`;

/**
 * Render the portal integration guide with tabbed code samples.
 * @param {object} opts
 * @param {string} opts.accountId
 * @param {string} opts.plan
 */
export function renderPortalIntegrate({ accountId, plan }) {
  const safeId = escapeHtml(accountId ?? '');
  const safePlan = escapeHtml(plan ?? 'free');

  const curlSample = `# 1. Hit the paid endpoint — you'll get a 402 with payment details
curl -s -w "\\n%{http_code}" \\
  https://your-api.example.com/v1/fetch \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com"}'

# Response: 402 Payment Required
# {
#   "error": "Payment Required",
#   "accepts": [
#     {
#       "scheme": "exact",
#       "network": "eip155:8453",
#       "payTo": "0x...",
#       "maxAmountRequired": "5000",
#       "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
#       "extra": { "name": "USDC", "decimals": 6 }
#     }
#   ]
# }

# 2. Pay on-chain (Base USDC transfer to payTo address)
#    ... use your wallet to send the exact amount ...

# 3. Retry with the payment proof header
curl -s https://your-api.example.com/v1/fetch \\
  -H "Content-Type: application/json" \\
  -H "X-PAYMENT: {txHash}:{chainId}:{nonce}" \\
  -d '{"url": "https://example.com"}'

# Response: 200 OK with scraped markdown`;

  const jsSample = `import { ethers } from 'ethers';

const API_URL = 'https://your-api.example.com';

// Step 1: Request the resource — get 402 challenge
const res = await fetch(\`\${API_URL}/v1/fetch\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://example.com' }),
});

if (res.status !== 402) {
  // Already paid or free — read the response
  const data = await res.json();
  console.log(data.markdown);
  process.exit(0);
}

// Step 2: Parse the 402 challenge
const challenge = await res.json();
const accept = challenge.accepts.find(
  (a) => a.network === 'eip155:8453',
);

// Step 3: Pay on Base (USDC ERC-20 transfer)
const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(process.env.AGENT_KEY, provider);
const usdc = new ethers.Contract(accept.asset, [
  'function transfer(address to, uint256 amount) returns (bool)',
], wallet);

const tx = await usdc.transfer(accept.payTo, accept.maxAmountRequired);
const receipt = await tx.wait(2); // wait for 2 confirmations

// Step 4: Retry with payment proof
const proof = \`\${receipt.hash}:8453:\${tx.nonce}\`;
const paid = await fetch(\`\${API_URL}/v1/fetch\`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-PAYMENT': proof,
  },
  body: JSON.stringify({ url: 'https://example.com' }),
});

const result = await paid.json();
console.log(result.title, result.markdown);`;

  const pySample = `from eth_account import Account
from web3 import Web3
import requests, os

API_URL = "https://your-api.example.com"

# Step 1: Request the resource — get 402 challenge
res = requests.post(f"{API_URL}/v1/fetch", json={"url": "https://example.com"})

if res.status_code != 402:
    print(res.json()["markdown"])
    exit()

# Step 2: Parse the 402 challenge
challenge = res.json()
accept = next(a for a in challenge["accepts"] if a["network"] == "eip155:8453")

# Step 3: Pay on Base (USDC ERC-20 transfer)
w3 = Web3(Web3.HTTPProvider("https://mainnet.base.org"))
acct = Account.from_key(os.environ["AGENT_KEY"])
usdc = w3.eth.contract(
    address=Web3.to_checksum_address(accept["asset"]),
    abi=[{
        "name": "transfer", "type": "function",
        "inputs": [{"name": "to", "type": "address"},
                    {"name": "amount", "type": "uint256"}],
        "outputs": [{"name": "", "type": "bool"}],
    }],
)

tx = usdc.functions.transfer(
    accept["payTo"], int(accept["maxAmountRequired"])
).build_transaction({
    "from": acct.address,
    "nonce": w3.eth.get_transaction_count(acct.address),
    "gas": 100000,
})
signed = acct.sign_transaction(tx)
tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)

# Step 4: Retry with payment proof
proof = f"{receipt.transactionHash.hex()}:8453:{tx['nonce']}"
paid = requests.post(
    f"{API_URL}/v1/fetch",
    json={"url": "https://example.com"},
    headers={"X-PAYMENT": proof},
)
print(paid.json()["title"], paid.json()["markdown"])`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x402 — Integration Guide</title>
<meta http-equiv="Content-Security-Policy" content="${PORTAL_CSP}">
<style>${THEME_CSS}${INTEGRATE_CSS}</style>
</head>
<body>
<div class="portal">
  <div class="portal-header">
    <h1>Integration Guide</h1>
    <div class="nav-links">
      <a href="/portal/dashboard" class="btn btn-ghost">Dashboard</a>
      <a href="/portal/logout" class="btn btn-ghost">Sign Out</a>
    </div>
  </div>

  <div class="card" style="margin-bottom: var(--sp-6);">
    <div class="section-title">Your Credentials</div>
    <p class="muted" style="margin-bottom: var(--sp-3);">Account: <code>${safeId}</code> &middot; Plan: <strong>${safePlan}</strong></p>
    <div class="note"><strong>Tip:</strong> Your API key is on the <a href="/portal/dashboard">Dashboard</a>. Never expose it in client-side code.</div>
  </div>

  <div class="card" style="margin-bottom: var(--sp-6);">
    <div class="section-title">How x402 Works</div>
    <div class="step">
      <span class="step-num">1</span><span class="step-title">Request a paid resource</span>
      <p>Send a normal HTTP request. If payment is required, you receive a <code>402</code> response with an <code>accepts</code> array describing accepted payment methods.</p>
    </div>
    <div class="step">
      <span class="step-num">2</span><span class="step-title">Pay on-chain</span>
      <p>Transfer the exact amount of USDC on Base (or another supported chain) to the <code>payTo</code> address in the challenge.</p>
    </div>
    <div class="step">
      <span class="step-num">3</span><span class="step-title">Retry with proof</span>
      <p>Re-send your request with the <code>X-PAYMENT</code> header containing <code>txHash:chainId:nonce</code>. The server verifies on-chain and returns the resource.</p>
    </div>
  </div>

  <div class="card">
    <div class="section-title">Code Samples</div>
    <div class="tabs" role="tablist">
      <button class="tab active" role="tab" aria-selected="true" data-tab="curl">curl</button>
      <button class="tab" role="tab" aria-selected="false" data-tab="javascript">JavaScript</button>
      <button class="tab" role="tab" aria-selected="false" data-tab="python">Python</button>
    </div>
    <div id="panel-curl" class="tab-panel active" role="tabpanel">
      <pre class="code-block"><code>${escapeHtml(curlSample)}</code></pre>
    </div>
    <div id="panel-javascript" class="tab-panel" role="tabpanel">
      <pre class="code-block"><code>${escapeHtml(jsSample)}</code></pre>
    </div>
    <div id="panel-python" class="tab-panel" role="tabpanel">
      <pre class="code-block"><code>${escapeHtml(pySample)}</code></pre>
    </div>
  </div>

  <div class="card" style="margin-top: var(--sp-6);">
    <div class="section-title">Reference</div>
    <p class="muted">Full API docs and OpenAPI spec: <a href="/docs">/docs</a> &middot; <a href="/openapi.yaml">openapi.yaml</a></p>
  </div>
</div>
<script>
document.querySelectorAll('.tab').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
  });
});
</script>
</body>
</html>`;
}

/**
 * Render the authenticated client portal dashboard.
 * @param {object} opts
 * @param {object}  opts.tenant  – { accountId, plan, createdAt }
 * @param {Array}   opts.payments
 * @param {Array}   opts.routes
 * @param {Array}   opts.usage   – monthly usage rows
 * @param {object|null} opts.rateLimitBucket – { tokens, capacity }
 */
export function renderPortalDashboard({ tenant, payments, routes, usage, rateLimitBucket }) {
  const plan = escapeHtml(tenant.plan ?? 'free');
  const created = escapeHtml(tenant.createdAt ?? '');
  const accountId = escapeHtml(tenant.accountId ?? '');

  const totalCalls = (usage ?? []).reduce((s, u) => s + (u.callCount ?? 0), 0);

  const bucketTokens = rateLimitBucket ? Math.floor(rateLimitBucket.tokens) : '\u2014';
  const bucketCap = rateLimitBucket ? rateLimitBucket.capacity : '\u2014';

  const usageRows = (usage ?? [])
    .map(
      (u) => `<tr>
    <td>${escapeHtml(u.yearMonth ?? '')}</td>
    <td>${escapeHtml(String(u.callCount ?? 0))}</td>
  </tr>`,
    )
    .join('\n');

  const paymentRows = (payments ?? [])
    .map(
      (p) => `<tr>
    <td>${escapeHtml(p.idempotencyKey ?? '')}</td>
    <td>${escapeHtml(p.amountWei ?? '')}</td>
    <td>${escapeHtml(p.assetSymbol ?? '')}</td>
    <td><span class="badge ${escapeHtml(p.status ?? '')}">${escapeHtml(p.status ?? '')}</span></td>
    <td><code>${escapeHtml((p.txHash ?? '').slice(0, 18))}${(p.txHash ?? '').length > 18 ? '...' : ''}</code></td>
    <td>${escapeHtml(p.createdAt ?? '')}</td>
  </tr>`,
    )
    .join('\n');

  const routeRows = (routes ?? [])
    .map(
      (r) => `<tr>
    <td><code>${escapeHtml(r.path ?? '')}</code></td>
    <td>${escapeHtml(r.priceWei ?? '0')} wei</td>
    <td>${escapeHtml(r.asset ?? 'USDC')}</td>
  </tr>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x402 — Portal</title>
<meta http-equiv="Content-Security-Policy" content="${PORTAL_CSP}">
<style>${THEME_CSS}
.portal { max-width: 960px; margin: 0 auto; padding: var(--sp-6); }
.portal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--sp-6); padding-bottom: var(--sp-4); border-bottom: 1px solid var(--line); }
.portal-header h1 { font-size: var(--text-xl); font-weight: 700; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--sp-4); margin-bottom: var(--sp-6); }
.stat-value { font-size: var(--text-2xl); font-weight: 700; color: var(--accent); }
.stat-label { font-size: var(--text-xs); color: var(--ink-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-top: var(--sp-1); }
.section-title { font-size: var(--text-lg); font-weight: 600; margin-bottom: var(--sp-3); }
.key-box { display: flex; align-items: center; gap: var(--sp-3); margin-top: var(--sp-3); }
.key-display { font-family: var(--font-mono); font-size: var(--text-sm); background: rgba(0,0,0,0.3); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-md); border: 1px solid var(--line); flex: 1; overflow: hidden; text-overflow: ellipsis; }
</style>
</head>
<body>
<div class="portal">
  <div class="portal-header">
    <h1>x402 Portal</h1>
    <a href="/portal/logout" class="btn btn-ghost">Sign Out</a>
  </div>

  <div class="cards">
    <div class="card">
      <div class="stat-label">Plan</div>
      <div class="stat-value">${plan}</div>
    </div>
    <div class="card">
      <div class="stat-label">Total Calls</div>
      <div class="stat-value">${totalCalls}</div>
    </div>
    <div class="card">
      <div class="stat-label">Rate Limit</div>
      <div class="stat-value">${bucketTokens} / ${bucketCap}</div>
    </div>
    <div class="card">
      <div class="stat-label">Member Since</div>
      <div class="stat-value" style="font-size:var(--text-md)">${created}</div>
    </div>
  </div>

  <div class="card">
    <div class="section-title">API Key</div>
    <p class="muted">Your key is hidden for security. Reveal to copy, or rotate to generate a new one.</p>
    <div class="key-box">
      <span class="key-display" id="apiKeyDisplay">\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022</span>
      <button class="btn btn-ghost" id="revealBtn" onclick="revealKey()">Reveal</button>
      <button class="btn btn-primary" id="rotateBtn" onclick="rotateKey()">Rotate</button>
    </div>
    <div id="keyMsg" class="muted" style="margin-top:var(--sp-2)"></div>
  </div>

  <div class="card">
    <div class="section-title">Usage</div>
    ${
      usageRows
        ? `<table>
      <thead><tr><th>Period</th><th>Calls</th></tr></thead>
      <tbody>${usageRows}</tbody>
    </table>`
        : '<p class="muted">No usage recorded yet.</p>'
    }
  </div>

  <div class="card">
    <div class="section-title">Recent Payments</div>
    ${
      paymentRows
        ? `<table>
      <thead><tr><th>Nonce</th><th>Amount (wei)</th><th>Asset</th><th>Status</th><th>Tx Hash</th><th>Date</th></tr></thead>
      <tbody>${paymentRows}</tbody>
    </table>`
        : '<p class="muted">No payments yet.</p>'
    }
  </div>

  <div class="card">
    <div class="section-title">Routes</div>
    ${
      routeRows
        ? `<table>
      <thead><tr><th>Path</th><th>Price</th><th>Asset</th></tr></thead>
      <tbody>${routeRows}</tbody>
    </table>`
        : '<p class="muted">No routes configured.</p>'
    }
  </div>
</div>
<script>
var revealed = false;
function revealKey() {
  var el = document.getElementById('apiKeyDisplay');
  var btn = document.getElementById('revealBtn');
  if (revealed) { el.textContent = '\u2022'.repeat(16); btn.textContent = 'Reveal'; revealed = false; }
  else { el.textContent = '${accountId}'; btn.textContent = 'Hide'; revealed = true; }
}
function rotateKey() {
  if (!confirm('Rotate your API key? The old key will stop working immediately.')) return;
  document.getElementById('keyMsg').textContent = 'Rotating...';
  fetch('/portal/rotate-key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.apiKey) {
      document.getElementById('apiKeyDisplay').textContent = d.apiKey;
      document.getElementById('keyMsg').textContent = 'Key rotated. Copy it now \\u2014 it will not be shown again.';
      revealed = true;
      document.getElementById('revealBtn').textContent = 'Hide';
    } else {
      document.getElementById('keyMsg').textContent = d.error || 'Rotation failed.';
    }
  })
  .catch(function() { document.getElementById('keyMsg').textContent = 'Network error.'; });
}
</script>
</body>
</html>`;
}
