// Public landing at GET /. Lives or dies by whether visitors install the
// npm package or sign up. Every section drives toward one of:
//   - npm install @bitbooth/mcp-fetch  (real conversion)
//   - GitHub stars / readme           (engineer trust)
//   - /demo/signup                    (frictionless tenant key for /v1/resource)

const DEMO_SIGNUP_JS = `
async function bitboothDemoSignup(ev) {
  ev.preventDefault();
  var email = document.getElementById('demo-email').value.trim();
  var result = document.getElementById('demo-result');
  result.className = 'demo-result';
  result.textContent = 'Creating your demo key…';
  try {
    var res = await fetch('/demo/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email })
    });
    var data = await res.json();
    if (!res.ok) {
      result.className = 'demo-result err';
      result.textContent = data.error || 'Signup failed. Please try again.';
      return false;
    }
    result.className = 'demo-result ok';
    result.innerHTML =
      '<strong>Key created.</strong> Save it now — we will never show it again.<br>' +
      '<code>' + data.apiKey + '</code><br>' +
      'Try it: <a href="/docs">/docs</a> · Manage: ' +
      '<a href="/dashboard?accountId=' + data.accountId + '">/dashboard</a>';
  } catch (err) {
    result.className = 'demo-result err';
    result.textContent = 'Network error. Please try again.';
  }
  return false;
}
`;

export const LANDING_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BitBooth — pay-per-call APIs for AI agents (x402)</title>
<meta name="description" content="The first working MCP server with pay-per-call billing via the x402 protocol. Your agent fetches a URL, pays $0.005 stablecoin per call, gets clean markdown back. No accounts, no API keys, no humans." />
<meta property="og:title" content="BitBooth — pay-per-call APIs for AI agents" />
<meta property="og:description" content="The first MCP server with pay-per-call billing via x402. Pay $0.005 USDC, get web content as markdown. No accounts." />
<meta property="og:url" content="https://app.heinrichstech.com" />
<meta name="twitter:card" content="summary_large_image" />

<style>
:root {
  color-scheme: dark;
  --bg: #05070b;
  --bg2: #0b1019;
  --panel: #111827;
  --panel2: #161e2e;
  --border: rgba(255, 255, 255, 0.08);
  --border2: rgba(255, 255, 255, 0.14);
  --ink: #e7ecf3;
  --ink-dim: #b8c2d4;
  --ink-mute: #8794ab;
  --accent: #14F195;
  --accent2: #23E5DB;
  --warn: #f5c542;
  --error: #ef4444;
  --success: #22c55e;
  --mono: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
  --sans: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  background: radial-gradient(ellipse at top, #0f1624 0%, #080b12 50%, #05070b 100%) fixed;
  color: var(--ink);
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}
a { color: var(--accent2); text-decoration: none; }
a:hover { color: var(--accent); }
code { font-family: var(--mono); background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 3px; font-size: 0.88em; color: var(--ink); }
pre { background: #0a0f18; border: 1px solid var(--border); border-radius: 8px; padding: 18px 22px; overflow-x: auto; font-family: var(--mono); font-size: 14px; line-height: 1.5; margin: 14px 0; position: relative; }
pre code { background: transparent; padding: 0; color: var(--ink); }
input, button { font-family: var(--sans); font-size: 15px; }
ol, ul { padding-left: 22px; color: var(--ink-dim); }
ol li, ul li { margin: 6px 0; }
strong { color: var(--ink); }

/* Top bar */
.bb-bar { background: linear-gradient(180deg, #0f1624 0%, #0b1019 100%); border-bottom: 1px solid var(--border); padding: 14px 24px; display: flex; align-items: center; gap: 14px; position: sticky; top: 0; z-index: 100; backdrop-filter: blur(8px); }
.bb-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.bb-dot { width: 12px; height: 12px; border-radius: 50%; background: linear-gradient(135deg, var(--accent) 0%, var(--accent2) 50%, #0052FF 100%); box-shadow: 0 0 16px rgba(20,241,149,0.5); animation: glow 3s ease-in-out infinite; }
@keyframes glow { 0%, 100% { box-shadow: 0 0 16px rgba(20,241,149,0.5); } 50% { box-shadow: 0 0 22px rgba(35,229,219,0.6); } }
.bb-name { font-size: 18px; font-weight: 800; letter-spacing: -0.01em; background: linear-gradient(90deg, #fff 0%, #cfd8e8 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.bb-spacer { flex: 1; }
.bb-nav { display: flex; gap: 4px; align-items: center; }
.bb-nav a { padding: 8px 14px; border-radius: 6px; font-size: 14px; color: var(--ink-dim); }
.bb-nav a:hover { background: rgba(255,255,255,0.06); color: var(--ink); }
.bb-nav a.cta { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #0a0f18; font-weight: 600; }
.bb-nav a.cta:hover { filter: brightness(1.1); color: #0a0f18; }

/* Layout */
.wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px; }

/* Hero */
.hero { padding: 80px 0 40px; text-align: center; }
.kicker { display: inline-block; font-family: var(--mono); font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase; color: var(--accent2); background: rgba(35,229,219,0.08); border: 1px solid rgba(35,229,219,0.2); padding: 6px 14px; border-radius: 99px; margin-bottom: 24px; }
.hero h1 { font-size: 56px; font-weight: 800; line-height: 1.05; letter-spacing: -0.03em; margin-bottom: 20px; background: linear-gradient(180deg, #ffffff 0%, #c0cad6 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.hero h1 .accent-grad { background: linear-gradient(135deg, var(--accent) 0%, var(--accent2) 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.hero .sub { font-size: 19px; color: var(--ink-dim); max-width: 720px; margin: 0 auto 36px; line-height: 1.5; }
.hero .ctas { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-bottom: 24px; }

.btn { display: inline-flex; align-items: center; gap: 8px; padding: 14px 22px; border-radius: 8px; font-weight: 600; font-size: 15px; cursor: pointer; transition: all 0.15s; border: none; text-decoration: none; }
.btn-primary { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #0a0f18; }
.btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); color: #0a0f18; }
.btn-secondary { background: var(--panel); color: var(--ink); border: 1px solid var(--border2); }
.btn-secondary:hover { background: var(--panel2); border-color: var(--accent2); color: var(--accent2); }
.btn-sm { padding: 8px 14px; font-size: 13px; }

.hero-tag { display: inline-flex; gap: 16px; font-family: var(--mono); font-size: 12px; color: var(--ink-mute); margin-top: 8px; flex-wrap: wrap; justify-content: center; }
.hero-tag span { display: inline-flex; align-items: center; gap: 6px; }
.hero-tag .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px var(--accent); }

.install-hero { background: linear-gradient(180deg, #0e1422 0%, #0a0f18 100%); border: 1px solid var(--border); border-radius: 12px; padding: 22px 26px; max-width: 640px; margin: 24px auto 0; position: relative; }
.install-hero pre { background: transparent; border: none; padding: 0; margin: 0; font-size: 16px; }
.install-hero .copy-btn { position: absolute; top: 14px; right: 14px; background: var(--panel2); border: 1px solid var(--border2); color: var(--ink-dim); font-family: var(--sans); font-size: 11px; padding: 4px 10px; border-radius: 4px; cursor: pointer; opacity: 0.6; transition: opacity 0.1s; }
.install-hero:hover .copy-btn { opacity: 1; }
.install-hero .copy-btn:hover { color: var(--ink); border-color: var(--accent2); }

/* Sections */
section { padding: 50px 0; }
.section-title { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 12px; }
.section-sub { color: var(--ink-dim); font-size: 16px; margin-bottom: 32px; }

/* Cards grid */
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
@media (max-width: 880px) { .grid-3 { grid-template-columns: 1fr; } }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 24px; }
.card h3 { font-size: 17px; font-weight: 600; margin-bottom: 8px; color: var(--ink); }
.card p { color: var(--ink-dim); font-size: 14px; line-height: 1.55; }
.card .num { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #0a0f18; font-family: var(--mono); font-weight: 800; font-size: 14px; margin-bottom: 12px; }

/* Pricing */
.price-table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.price-table th, .price-table td { padding: 14px 18px; text-align: left; border-bottom: 1px solid var(--border); }
.price-table thead th { background: var(--panel2); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-mute); font-weight: 600; }
.price-table tbody tr:last-child td { border-bottom: none; }
.price-table .mode { font-family: var(--mono); color: var(--accent); font-weight: 600; }
.price-table .price { font-family: var(--mono); font-weight: 700; color: var(--ink); }
.price-table .desc { color: var(--ink-dim); font-size: 14px; }
.price-table .badge { background: rgba(245,197,66,0.12); color: var(--warn); font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 3px; margin-left: 6px; letter-spacing: 0.06em; vertical-align: middle; }

/* Flow */
.flow { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 22px; margin: 18px 0; font-family: var(--mono); font-size: 12.5px; line-height: 1.7; color: var(--ink-dim); white-space: pre; overflow-x: auto; }

/* Stats */
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
@media (max-width: 880px) { .stats { grid-template-columns: repeat(2, 1fr); } }
.stat { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 18px; text-align: center; }
.stat-val { font-family: var(--mono); font-size: 22px; font-weight: 700; color: var(--accent); }
.stat-lbl { font-size: 11px; color: var(--ink-mute); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }

/* Demo signup */
.demo-panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 28px; }
.demo-panel form { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
.demo-panel label { font-size: 13px; color: var(--ink-mute); font-weight: 500; display: block; margin-bottom: 6px; }
.demo-panel input { flex: 1; min-width: 240px; padding: 12px 14px; border-radius: 6px; border: 1px solid var(--border2); background: var(--bg2); color: var(--ink); font-family: var(--mono); font-size: 14px; }
.demo-panel input:focus { outline: 2px solid var(--accent2); outline-offset: -1px; border-color: var(--accent2); }
.demo-result { margin-top: 14px; padding: 12px 16px; border-radius: 6px; font-size: 13px; }
.demo-result.ok { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.3); color: var(--ink); }
.demo-result.err { background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.3); color: var(--error); }
.demo-result code { display: block; padding: 8px; margin: 8px 0; word-break: break-all; background: var(--bg2); }

/* Footer */
footer { padding: 50px 0 36px; border-top: 1px solid var(--border); margin-top: 60px; text-align: center; color: var(--ink-mute); font-family: var(--mono); font-size: 12px; }
footer a { color: var(--ink-dim); margin: 0 8px; }
footer a:hover { color: var(--ink); }
</style>
</head>
<body>

<div class="bb-bar">
  <a href="/" class="bb-brand">
    <span class="bb-dot"></span>
    <span class="bb-name">BitBooth</span>
  </a>
  <div class="bb-spacer"></div>
  <nav class="bb-nav">
    <a href="/docs/agents">Install</a>
    <a href="/docs">API</a>
    <a href="https://github.com/Drock91/bitbooth-gateway" target="_blank" rel="noopener">GitHub</a>
    <a href="/dashboard/signup" class="cta">Get API key →</a>
  </nav>
</div>

<div class="wrap">

  <section class="hero">
    <div class="kicker">x402 · MCP · multi-chain</div>
    <h1>Pay-per-call APIs<br/>for <span class="accent-grad">AI agents</span>.</h1>
    <p class="sub">The first working <a href="https://x402.gitbook.io" target="_blank" rel="noopener">x402 protocol</a> MCP server. Your agent fetches a URL, pays $0.005 stablecoin on-chain, gets clean markdown back. No API keys, no signup, no humans in the loop.</p>

    <div class="ctas">
      <a class="btn btn-primary" href="/docs/agents">Install in 30 seconds →</a>
      <a class="btn btn-secondary" href="https://github.com/Drock91/bitbooth-gateway" target="_blank" rel="noopener">⭐ Star on GitHub</a>
    </div>

    <div class="install-hero">
      <pre><code>npm install @bitbooth/mcp-fetch</code></pre>
      <button class="copy-btn" onclick="navigator.clipboard.writeText('npm install @bitbooth/mcp-fetch'); this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy',1500);">Copy</button>
    </div>

    <div class="hero-tag">
      <span><span class="dot"></span> Live · XRPL Mainnet + Base Sepolia</span>
      <span><span class="dot"></span> 1.3s end-to-end</span>
      <span><span class="dot"></span> MIT licensed</span>
    </div>
  </section>

  <section>
    <h2 class="section-title">How it works</h2>
    <p class="section-sub">No credentials exchanged. The agent's wallet pays per request, the gateway verifies on-chain, returns content.</p>
    <div class="flow">Agent                         BitBooth                        Web
  │                              │                               │
  │── POST /v1/fetch ───────────►│                               │
  │◄── 402 Payment Required ─────│  (challenge: amount, nonce)   │
  │                              │                               │
  │── send USDC on-chain ─────────────────────────────────────► │
  │── retry with X-Payment ─────►│                               │
  │                              │── verify on-chain ────────►   │
  │                              │── fetch + clean markdown ─►   │
  │◄── 200 OK + markdown ────────│                               │</div>
  </section>

  <section>
    <h2 class="section-title">Pricing</h2>
    <p class="section-sub">Pay-per-call. No subscriptions. No accounts. Settled in stablecoin on-chain.</p>
    <table class="price-table">
      <thead><tr><th>Mode</th><th>What you get</th><th>Price</th></tr></thead>
      <tbody>
        <tr>
          <td class="mode">fast</td>
          <td class="desc">Raw HTML → clean markdown</td>
          <td class="price">$0.005 USDC</td>
        </tr>
        <tr>
          <td class="mode">full</td>
          <td class="desc">Article extraction (Readability + Turndown) → cleaner markdown for LLMs</td>
          <td class="price">$0.005 USDC</td>
        </tr>
        <tr>
          <td class="mode">render <span class="badge">SHIPPING</span></td>
          <td class="desc">Playwright JS rendering for SPAs (Twitter, LinkedIn, React dashboards)</td>
          <td class="price">$0.02 USDC</td>
        </tr>
      </tbody>
    </table>
    <p style="margin-top:14px;color:var(--ink-mute);font-size:13px;">
      Default install spends free Base Sepolia testnet USDC. Opt into mainnet (real USDC on Base, or XRP / USDC / RLUSD on XRPL Mainnet) by setting <code>BITBOOTH_CHAIN_ID=8453</code>.
    </p>
  </section>

  <section>
    <h2 class="section-title">Why x402</h2>
    <p class="section-sub">The cleanest agent-payment spec we've seen. Coinbase + Linux Foundation, 2025.</p>
    <div class="grid-3">
      <div class="card">
        <h3>🔓 No accounts</h3>
        <p>Agents don't fill out signup forms. They have wallets. The wallet pays. That's the protocol.</p>
      </div>
      <div class="card">
        <h3>💰 Bounded autonomy</h3>
        <p>Max loss = wallet balance. Unlike API keys (unlimited subscription), an agent can't overspend.</p>
      </div>
      <div class="card">
        <h3>⛓️ Multi-chain</h3>
        <p>Each 402 challenge advertises Base Sepolia, XRPL Mainnet, more. Agent picks the rail it has balance on.</p>
      </div>
    </div>
  </section>

  <section>
    <h2 class="section-title">Real money, verified</h2>
    <p class="section-sub">Not a demo, not vaporware. Receipts on-chain.</p>
    <div class="stats">
      <div class="stat">
        <div class="stat-val">1.3s</div>
        <div class="stat-lbl">XRPL Mainnet round-trip</div>
      </div>
      <div class="stat">
        <div class="stat-val">2 chains</div>
        <div class="stat-lbl">XRPL + Base live</div>
      </div>
      <div class="stat">
        <div class="stat-val">3,300+</div>
        <div class="stat-lbl">unit tests, MIT</div>
      </div>
      <div class="stat">
        <div class="stat-val">Sub-2s</div>
        <div class="stat-lbl">P50 fetch latency</div>
      </div>
    </div>
    <p style="margin-top:18px;color:var(--ink-mute);font-size:13px;">
      Last verified mainnet payment: <a href="https://xrpscan.com/tx/493F6F1ADB9D258898A028F1D0A34684F5DD8B8C9F99BC6FB3432EA1F8AA45C0" target="_blank" rel="noopener" style="font-family:var(--mono);">493F6F1A…45C0</a> · 0.005 XRP settled in 1.3s
    </p>
  </section>

  <section id="demo">
    <h2 class="section-title">Get a free API key</h2>
    <p class="section-sub">For tenant-scoped routes (<code>/v1/resource</code>, multi-tenant rate limits, future paid endpoints). Free signup, no credit card. The <code>/v1/fetch</code> endpoint above doesn't need a key — it's pure x402.</p>
    <div class="demo-panel">
      <form onsubmit="return bitboothDemoSignup(event)">
        <div style="flex: 1; min-width: 240px;">
          <label for="demo-email">Email (so we can send updates if/when something major changes)</label>
          <input id="demo-email" type="email" name="email" required autocomplete="email" placeholder="you@company.com" />
        </div>
        <button class="btn btn-primary" type="submit">Get my key</button>
      </form>
      <div id="demo-result" role="status" aria-live="polite"></div>
    </div>
  </section>

  <section>
    <h2 class="section-title">Get started</h2>
    <p class="section-sub">Three steps. ~5 minutes. Free testnet.</p>
    <div class="grid-3">
      <div class="card">
        <div class="num">1</div>
        <h3>Install</h3>
        <p style="margin-bottom:14px;">Drop into any MCP-aware agent (Claude Desktop, Cursor, Continue, Cline).</p>
        <a href="/docs/agents" class="btn btn-secondary btn-sm">Setup guide →</a>
      </div>
      <div class="card">
        <div class="num">2</div>
        <h3>Fund a wallet</h3>
        <p style="margin-bottom:14px;">Free Base Sepolia ETH + USDC from public faucets. ~10 USDC = 2,000 fetches.</p>
        <a href="https://faucet.circle.com" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Faucet →</a>
      </div>
      <div class="card">
        <div class="num">3</div>
        <h3>Use it</h3>
        <p style="margin-bottom:14px;">Ask your agent to fetch any URL. The wallet auto-pays. You get markdown back.</p>
        <a href="https://www.npmjs.com/package/@bitbooth/mcp-fetch" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">npm package →</a>
      </div>
    </div>
  </section>

</div>

<footer>
  Open source under MIT.
  <a href="https://github.com/Drock91/bitbooth-gateway" target="_blank" rel="noopener">GitHub</a> ·
  <a href="https://www.npmjs.com/package/@bitbooth/mcp-fetch" target="_blank" rel="noopener">npm</a> ·
  <a href="/docs/agents">Setup</a> ·
  <a href="/docs">API</a> ·
  <a href="https://x402.gitbook.io" target="_blank" rel="noopener">x402 spec</a>
</footer>

<script>${DEMO_SIGNUP_JS}</script>
</body>
</html>`;
