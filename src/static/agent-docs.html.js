// Agent-onboarding docs page served at /docs/agents.
// Goal: get someone from "I just heard of BitBooth" to "my agent just paid
// for a fetch" in under 5 minutes. Install snippets for every major MCP
// client + faucet links + env var reference + troubleshooting.

export const AGENT_DOCS_HTML = /* html */ `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BitBooth — Install in your agent</title>
<meta name="description" content="Get any MCP-aware AI agent (Claude, Cursor, Continue, Cline) paying for fetches via x402 in 30 seconds. Free testnet by default; opt into real money explicitly.">
<style>
:root {
  --bg: #05070b;
  --bg2: #0b1019;
  --panel: #0f1624;
  --panel2: #131a2a;
  --ink: #e7ecf3;
  --ink-dim: #a3aec1;
  --ink-mute: #6b768a;
  --border: rgba(255,255,255,0.08);
  --border2: rgba(255,255,255,0.14);
  --accent: #14F195;
  --accent2: #23E5DB;
  --accent3: #0052FF;
  --warn: #f5c542;
  --danger: #ef4444;
  --sans: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --mono: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(ellipse at top, #0f1624 0%, #080b12 50%, #05070b 100%);color:var(--ink);font-family:var(--sans);min-height:100vh;font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--accent2);text-decoration:none}
a:hover{color:var(--accent);text-decoration:underline}
code{font-family:var(--mono);background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:3px;font-size:0.88em}
pre{background:#0a0f18;border:1px solid var(--border);border-radius:6px;padding:14px 18px;overflow-x:auto;margin:14px 0;font-family:var(--mono);font-size:13px;line-height:1.5}
pre code{background:transparent;padding:0;color:var(--ink)}
h1,h2,h3{letter-spacing:-0.02em;margin-top:0}
h2{font-size:24px;font-weight:700;margin-top:48px;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--border)}
h3{font-size:17px;font-weight:600;margin-top:28px;margin-bottom:10px;color:var(--ink)}
p{margin:10px 0;color:var(--ink-dim)}
strong{color:var(--ink);font-weight:600}
ul,ol{margin:10px 0 10px 24px;color:var(--ink-dim)}
li{margin:6px 0}
table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--border)}
th{font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:var(--ink-dim);background:var(--panel2)}
td{color:var(--ink-dim)}
td code{font-size:12px}

/* Top bar */
.bb-bar{background:linear-gradient(180deg,#0f1624 0%,#0b1019 100%);border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:10;backdrop-filter:blur(8px)}
.bb-brand{display:flex;align-items:center;gap:10px;text-decoration:none}
.bb-dot{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,#14F195 0%,#23E5DB 50%,#0052FF 100%);box-shadow:0 0 12px rgba(20,241,149,0.5)}
.bb-name{font-size:16px;font-weight:700;letter-spacing:-0.01em;background:linear-gradient(90deg,#fff 0%,#cfd8e8 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.bb-divider{width:1px;height:20px;background:rgba(255,255,255,0.12)}
.bb-section{font-family:var(--mono);font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:var(--ink-dim)}
.bb-spacer{flex:1}
.bb-nav{display:flex;gap:2px}
.bb-nav a{padding:6px 12px;border-radius:4px;font-size:13px;color:var(--ink-dim)}
.bb-nav a:hover{background:rgba(255,255,255,0.06);color:var(--ink);text-decoration:none}

/* Layout */
.wrap{max-width:880px;margin:0 auto;padding:40px 24px 80px}
.hero{padding:24px 0 8px}
.hero h1{font-size:42px;font-weight:800;line-height:1.1;background:linear-gradient(90deg,#fff 0%,#cfd8e8 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:14px}
.hero .subtitle{font-size:18px;color:var(--ink-dim);max-width:600px;margin-bottom:20px}
.kicker{display:inline-block;font-family:var(--mono);font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:var(--accent2);background:rgba(35,229,219,0.08);border:1px solid rgba(35,229,219,0.18);padding:4px 10px;border-radius:99px;margin-bottom:14px}

/* Callouts */
.callout{margin:18px 0;padding:16px 20px;border-radius:6px;border-left:3px solid var(--accent2);background:rgba(35,229,219,0.04)}
.callout.warn{border-left-color:var(--warn);background:rgba(245,197,66,0.05)}
.callout.danger{border-left-color:var(--danger);background:rgba(239,68,68,0.05)}
.callout p:first-child{margin-top:0}
.callout p:last-child{margin-bottom:0}
.callout strong{color:var(--ink)}

/* Tabs */
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin:24px 0 0;flex-wrap:wrap}
.tab{padding:10px 16px;font-size:14px;color:var(--ink-dim);cursor:pointer;border:none;background:none;font-family:inherit;border-bottom:2px solid transparent;transition:color 0.1s,border-color 0.1s}
.tab:hover{color:var(--ink)}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab-content{display:none;padding-top:8px}
.tab-content.active{display:block}

/* Steps */
.step{display:flex;gap:18px;margin:22px 0;padding:18px;background:var(--panel);border:1px solid var(--border);border-radius:6px}
.step-num{flex-shrink:0;width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#0a0f18;font-weight:800;font-family:var(--mono);display:flex;align-items:center;justify-content:center;font-size:14px}
.step-body{flex:1;min-width:0}
.step-body h3{margin-top:0}
.step-body p:last-child{margin-bottom:0}

/* Footer */
.footer{margin-top:60px;padding:24px 0;border-top:1px solid var(--border);text-align:center;font-family:var(--mono);font-size:12px;color:var(--ink-mute)}
.footer a{color:var(--ink-dim)}

/* Copy buttons (no JS heaviness) */
.copy-pre{position:relative}
.copy-btn{position:absolute;top:8px;right:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--ink-dim);font-family:inherit;font-size:11px;padding:4px 10px;border-radius:4px;cursor:pointer;opacity:0;transition:opacity 0.1s}
.copy-pre:hover .copy-btn{opacity:1}
.copy-btn:hover{background:rgba(255,255,255,0.12);color:var(--ink)}

/* Pricing pill */
.pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;letter-spacing:0.04em;background:rgba(255,255,255,0.06);color:var(--ink-dim);font-family:var(--mono)}
.pill.real{background:rgba(20,241,149,0.12);color:var(--accent)}
.pill.test{background:rgba(245,197,66,0.12);color:var(--warn)}
</style>
</head>
<body>

<div class="bb-bar">
  <a href="/" class="bb-brand">
    <span class="bb-dot"></span>
    <span class="bb-name">BitBooth</span>
  </a>
  <div class="bb-divider"></div>
  <div class="bb-section">Agent Setup</div>
  <div class="bb-spacer"></div>
  <nav class="bb-nav">
    <a href="/">Home</a>
    <a href="/docs">API Reference</a>
    <a href="https://github.com/Drock91/bitbooth-gateway" target="_blank" rel="noopener">GitHub</a>
    <a href="https://www.npmjs.com/package/@bitbooth/mcp-fetch" target="_blank" rel="noopener">npm</a>
  </nav>
</div>

<div class="wrap">

  <div class="hero">
    <div class="kicker">install in 30 seconds</div>
    <h1>Get your agent paying for fetches.</h1>
    <p class="subtitle">BitBooth is an MCP server that lets any AI agent fetch URLs and get back clean markdown — paying per call via the x402 protocol. Free testnet by default. Opt into real money explicitly.</p>
  </div>

  <div class="callout warn">
    <p><strong>Honest framing:</strong> the fetch+markdown logic in v1.0.x is functionally equivalent to the free <code>@modelcontextprotocol/server-fetch</code>. Install BitBooth to <strong>understand the x402 protocol</strong>. The version that's worth paying for ships in 2 weeks (JS rendering via Playwright). Track <a href="https://github.com/Drock91/bitbooth-gateway/blob/main/GOALS.md" target="_blank" rel="noopener">GOALS.md</a>.</p>
  </div>

  <h2>1. Pick your MCP client</h2>

  <div class="tabs" role="tablist">
    <button class="tab active" data-tab="claude-desktop">Claude Desktop</button>
    <button class="tab" data-tab="claude-code">Claude Code (CLI)</button>
    <button class="tab" data-tab="cursor">Cursor</button>
    <button class="tab" data-tab="continue">Continue.dev</button>
    <button class="tab" data-tab="raw">Raw JSON-RPC</button>
  </div>

  <div class="tab-content active" data-tab="claude-desktop">
    <p>Edit <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (Mac) or <code>%APPDATA%\\Claude\\claude_desktop_config.json</code> (Windows):</p>
    <div class="copy-pre"><pre><code>{
  "mcpServers": {
    "bitbooth-fetch": {
      "command": "npx",
      "args": ["-y", "@bitbooth/mcp-fetch"],
      "env": {
        "BITBOOTH_AGENT_KEY": "0xYOUR_BASE_SEPOLIA_TESTNET_PRIVATE_KEY"
      }
    }
  }
}</code><button class="copy-btn">Copy</button></pre></div>
    <p>Restart Claude Desktop. Your agent now has a <code>fetch</code> tool.</p>
  </div>

  <div class="tab-content" data-tab="claude-code">
    <div class="copy-pre"><pre><code>claude mcp add bitbooth-fetch -- npx -y @bitbooth/mcp-fetch
export BITBOOTH_AGENT_KEY="0xYOUR_BASE_SEPOLIA_TESTNET_PRIVATE_KEY"</code><button class="copy-btn">Copy</button></pre></div>
  </div>

  <div class="tab-content" data-tab="cursor">
    <p>Cursor → Settings → MCP → "Edit in settings.json":</p>
    <div class="copy-pre"><pre><code>{
  "mcpServers": {
    "bitbooth-fetch": {
      "command": "npx",
      "args": ["-y", "@bitbooth/mcp-fetch"],
      "env": { "BITBOOTH_AGENT_KEY": "0xYOUR_TESTNET_PK" }
    }
  }
}</code><button class="copy-btn">Copy</button></pre></div>
  </div>

  <div class="tab-content" data-tab="continue">
    <p>Edit <code>~/.continue/config.json</code>:</p>
    <div class="copy-pre"><pre><code>{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@bitbooth/mcp-fetch"],
          "env": { "BITBOOTH_AGENT_KEY": "0xYOUR_TESTNET_PK" }
        }
      }
    ]
  }
}</code><button class="copy-btn">Copy</button></pre></div>
  </div>

  <div class="tab-content" data-tab="raw">
    <p>If you're building your own agent client, BitBooth speaks the standard MCP 2025-06-18 protocol over stdio. To verify the package boots:</p>
    <div class="copy-pre"><pre><code>echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"my-agent","version":"1.0"}}}' | \\
  BITBOOTH_AGENT_KEY=0xYOUR_PK npx -y @bitbooth/mcp-fetch</code><button class="copy-btn">Copy</button></pre></div>
    <p>Returns the standard MCP initialize response. The package exposes one tool: <code>fetch(url, mode)</code>.</p>
  </div>

  <h2>2. Get a testnet wallet (free, 2 minutes)</h2>

  <div class="step">
    <div class="step-num">1</div>
    <div class="step-body">
      <h3>Generate or use an EVM wallet you already control</h3>
      <p>Any wallet works — MetaMask, Rabby, hardware wallets. <strong>Use a dedicated wallet for the agent.</strong> Don't put your personal wallet's private key in agent configs.</p>
    </div>
  </div>

  <div class="step">
    <div class="step-num">2</div>
    <div class="step-body">
      <h3>Get free Base Sepolia ETH (for gas)</h3>
      <p><a href="https://www.alchemy.com/faucets/base-sepolia" target="_blank" rel="noopener">alchemy.com/faucets/base-sepolia</a> — paste your wallet address, get a small amount of test ETH.</p>
    </div>
  </div>

  <div class="step">
    <div class="step-num">3</div>
    <div class="step-body">
      <h3>Get free Base Sepolia USDC (for payments)</h3>
      <p><a href="https://faucet.circle.com" target="_blank" rel="noopener">faucet.circle.com</a> → select Base Sepolia → drip 10 USDC. Enough for ~2,000 fetches.</p>
    </div>
  </div>

  <div class="step">
    <div class="step-num">4</div>
    <div class="step-body">
      <h3>Set <code>BITBOOTH_AGENT_KEY</code></h3>
      <p>Use the wallet's private key (the <code>0x</code>-prefixed hex string). It goes in the <code>env</code> block of your MCP config (see step 1).</p>
    </div>
  </div>

  <h2>3. Use it from your agent</h2>

  <p>Once installed, your agent has access to a <code>fetch</code> tool. Try a prompt like:</p>

  <div class="copy-pre"><pre><code>"Use the bitbooth-fetch tool to fetch https://example.com and summarize what you see."</code><button class="copy-btn">Copy</button></pre></div>

  <p>The agent will pay 0.005 USDC on Base Sepolia (free testnet money), the gateway will return clean markdown, and the agent will read it. Total round-trip: ~1.3 seconds.</p>

  <h2>4. Modes + pricing</h2>

  <table>
    <thead><tr><th>Mode</th><th>What it does</th><th>Best for</th><th>Price</th></tr></thead>
    <tbody>
      <tr><td><code>fast</code> (default)</td><td>Raw HTML → markdown</td><td>Quick lookups, simple pages</td><td>0.005 <span class="pill test">USDC</span></td></tr>
      <tr><td><code>full</code></td><td>Article extraction → markdown</td><td>Blog posts, docs, news</td><td>0.005 <span class="pill test">USDC</span></td></tr>
      <tr><td><code>render</code> (coming Q2)</td><td>JS-rendered via Playwright</td><td>SPAs, dashboards, JS-heavy</td><td>0.02 <span class="pill test">USDC</span></td></tr>
    </tbody>
  </table>

  <h2>5. Going to mainnet (real money)</h2>

  <div class="callout warn">
    <p><strong>Default is testnet.</strong> When you opt in, the package prints a stderr warning every fetch so you can't accidentally drain a real wallet. Set these env vars only after you've verified the testnet flow works:</p>
  </div>

  <div class="copy-pre"><pre><code># Real Base mainnet (USDC) — 0.005 USDC per fetch (~$0.005)
export BITBOOTH_CHAIN_ID=8453
export BITBOOTH_API_URL=https://app.heinrichstech.com
export BITBOOTH_RPC_URL=https://base-rpc.publicnode.com
export BITBOOTH_AGENT_KEY=0xWALLET_FUNDED_WITH_REAL_USDC</code><button class="copy-btn">Copy</button></pre></div>

  <p>Today's only end-to-end-verified <strong>real money</strong> rail is XRPL Mainnet (XRP). Native XRPL signing in this MCP package is roadmapped (track <a href="https://github.com/Drock91/bitbooth-gateway/issues" target="_blank" rel="noopener">GitHub issues</a>). For now, pay-per-call mainnet via the npm package = Base Mainnet USDC.</p>

  <h2>6. Configuration reference</h2>

  <table>
    <thead><tr><th>Env var</th><th>Default</th><th>Purpose</th></tr></thead>
    <tbody>
      <tr><td><code>BITBOOTH_AGENT_KEY</code></td><td><em>required</em></td><td>0x-prefixed EVM wallet private key. <strong>Use a dedicated wallet.</strong></td></tr>
      <tr><td><code>BITBOOTH_CHAIN_ID</code></td><td><code>84532</code></td><td><code>84532</code> = Base Sepolia (testnet). <code>8453</code> = Base Mainnet (real money).</td></tr>
      <tr><td><code>BITBOOTH_API_URL</code></td><td><code>https://app.heinrichstech.com</code></td><td>BitBooth gateway endpoint.</td></tr>
      <tr><td><code>BITBOOTH_RPC_URL</code></td><td>chain default</td><td>EVM RPC node URL.</td></tr>
      <tr><td><code>BITBOOTH_CONFIRMATIONS</code></td><td><code>1</code></td><td>Tx confirmations to wait before retrying with X-Payment.</td></tr>
      <tr><td><code>BITBOOTH_API_KEY</code></td><td><em>none</em></td><td>Optional tenant API key for higher rate limits (sign up at <a href="/dashboard">/dashboard</a>).</td></tr>
    </tbody>
  </table>

  <h2>7. Troubleshooting</h2>

  <table>
    <thead><tr><th>Symptom</th><th>Fix</th></tr></thead>
    <tbody>
      <tr><td><code>Agent wallet key required</code></td><td><code>BITBOOTH_AGENT_KEY</code> env var is unset. Check your MCP config's <code>env</code> block.</td></tr>
      <tr><td><code>Wallet 0x... has no ETH for gas</code></td><td>Hit <a href="https://www.alchemy.com/faucets/base-sepolia" target="_blank" rel="noopener">alchemy.com/faucets/base-sepolia</a> with your wallet address.</td></tr>
      <tr><td><code>Wallet 0x... has no USDC</code></td><td>Hit <a href="https://faucet.circle.com" target="_blank" rel="noopener">faucet.circle.com</a> → Base Sepolia → 10 USDC.</td></tr>
      <tr><td><code>Unexpected HTTP 502</code></td><td>Gateway upstream is briefly down. Retry in ~30s. <a href="https://github.com/Drock91/bitbooth-gateway/issues" target="_blank" rel="noopener">File an issue</a> if persistent.</td></tr>
      <tr><td>Tool doesn't appear in agent</td><td>Restart your MCP client. Check the client's MCP server logs for boot errors.</td></tr>
    </tbody>
  </table>

  <h2>8. What's next</h2>

  <ul>
    <li><a href="https://github.com/Drock91/bitbooth-gateway/blob/main/GOALS.md" target="_blank" rel="noopener">GOALS.md</a> — full roadmap, prioritized</li>
    <li><a href="/docs">API Reference</a> — Swagger UI for the gateway endpoints</li>
    <li><a href="https://github.com/Drock91/bitbooth-gateway/blob/main/SMOKE_TEST.md" target="_blank" rel="noopener">SMOKE_TEST.md</a> — 30-second install verification</li>
    <li><a href="https://github.com/Drock91/bitbooth-gateway/tree/main/examples" target="_blank" rel="noopener">examples/</a> — runnable demos (curl, Node EVM, Node XRPL, LangChain)</li>
    <li><a href="https://x402.gitbook.io" target="_blank" rel="noopener">x402 V2 spec</a> — the underlying protocol</li>
  </ul>

  <div class="footer">
    Open source under MIT. <a href="https://github.com/Drock91/bitbooth-gateway" target="_blank" rel="noopener">github.com/Drock91/bitbooth-gateway</a> · <a href="https://www.npmjs.com/package/@bitbooth/mcp-fetch" target="_blank" rel="noopener">@bitbooth/mcp-fetch on npm</a>
  </div>

</div>

<script>
(function() {
  // Tabs
  document.querySelectorAll('.tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var tabId = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelector('.tab-content[data-tab="' + tabId + '"]').classList.add('active');
    });
  });

  // Copy buttons
  document.querySelectorAll('.copy-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      var pre = btn.closest('pre');
      var code = pre.querySelector('code');
      if (!code) return;
      var text = code.innerText;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
          var orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(function() { btn.textContent = orig; }, 1500);
        });
      }
    });
  });
})();
</script>

</body>
</html>`;
