import { FETCH_CSS } from './fetch.css.js';

const DEMO_JS = `
var demoOutput = document.getElementById('demo-output');
var demoBtn = document.getElementById('demo-btn');
var demoUrl = document.getElementById('demo-url');

function appendLine(text, cls) {
  var span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  demoOutput.appendChild(span);
  demoOutput.appendChild(document.createTextNode('\\n'));
  demoOutput.scrollTop = demoOutput.scrollHeight;
}

function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function runDemo() {
  demoBtn.disabled = true;
  demoOutput.textContent = '';
  var url = demoUrl.value.trim() || 'https://example.com';

  appendLine('POST /v1/fetch', 'phase');
  appendLine('{ "url": "' + url + '", "mode": "markdown" }');
  await delay(400);

  appendLine('');
  appendLine('HTTP 402 Payment Required', 'phase');
  appendLine('WWW-Authenticate: X402');
  appendLine('{');
  appendLine('  "challenge": {');
  appendLine('    "accepts": [');
  appendLine('      { "network": "eip155:8453", "amount": "5000", "asset": "USDC" },');
  appendLine('      { "network": "solana:mainnet", "amount": "5000", "asset": "USDC" }');
  appendLine('    ]');
  appendLine('  }');
  appendLine('}');
  await delay(600);

  appendLine('');
  appendLine('Sending 0.005 USDC on Base...', 'phase');
  appendLine('tx: 0x7a3f...c91d  confirmed (2 blocks)');
  await delay(500);

  appendLine('');
  appendLine('Retrying with X-PAYMENT header...', 'phase');
  await delay(300);

  appendLine('');
  appendLine('HTTP 200 OK', 'phase');
  appendLine('{');
  appendLine('  "title": "' + url.replace(/https?:\\/\\//, '').split('/')[0] + '",');
  appendLine('  "markdown": "# Page Content\\n\\nScraped and converted...",');
  appendLine('  "metadata": { "contentLength": 4821, "truncated": false }');
  appendLine('}');
  await delay(200);

  appendLine('');
  appendLine('Done. Cost: $0.005 USDC. No API key needed for payment.', 'phase');
  demoBtn.disabled = false;
}

function switchTab(group, name) {
  var tabs = document.querySelectorAll('[data-group="' + group + '"]');
  var panels = document.querySelectorAll('[data-panel-group="' + group + '"]');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].className = tabs[i].getAttribute('data-tab') === name ? 'tab active' : 'tab';
  }
  for (var j = 0; j < panels.length; j++) {
    panels[j].className = panels[j].getAttribute('data-panel') === name ? 'tab-panel active' : 'tab-panel';
  }
}
`;

export const FETCH_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BitBooth Fetch — Pay-per-scrape for AI agents</title>
    <meta name="description" content="Scrape any URL for $0.005 USDC. No API keys needed — just a funded wallet and the x402 protocol. Built for LangChain, crewAI, and Claude agents." />
    <style>${FETCH_CSS}</style>
  </head>
  <body>
    <div class="wrap">
      <header>
        <span class="mark">bitbooth</span>
        <nav>
          <a href="/">home</a>
          <a href="/docs">docs</a>
          <a href="/dashboard">dashboard</a>
        </nav>
      </header>

      <h1>Pay-per-scrape for AI&nbsp;agents.</h1>
      <p class="tagline">
        $0.005 per fetch. No API keys. Your agent sends USDC on Base or Solana,
        gets clean markdown back. One HTTP round-trip via
        <a href="https://www.x402.org" rel="noopener noreferrer">x402</a>.
      </p>

      <div class="cta-row">
        <a class="btn btn-primary" href="#demo">Try the live demo</a>
        <a class="btn btn-ghost" href="/docs">API reference</a>
      </div>

      <!-- How it works -->
      <section>
        <h2>How it works</h2>
        <ol class="steps">
          <li>Agent sends <strong>POST /v1/fetch</strong> with a target URL.</li>
          <li>Server returns <strong>402 Payment Required</strong> with a multi-chain x402 challenge.</li>
          <li>Agent pays <strong>$0.005 USDC</strong> on Base or Solana, retries with the payment proof.</li>
          <li>Server verifies on-chain, scrapes the page, returns <strong>clean markdown</strong>.</li>
        </ol>
      </section>

      <!-- Interactive demo -->
      <section id="demo">
        <h2>Live demo</h2>
        <div class="demo-box">
          <div class="demo-header">
            <span>x402 fetch flow (simulated)</span>
            <button id="demo-btn" class="btn btn-primary" onclick="runDemo()" style="padding:6px 16px;font-size:13px;">
              Run
            </button>
          </div>
          <div class="demo-body">
            <input type="text" id="demo-url" value="https://example.com" placeholder="Enter any URL" aria-label="URL to fetch" />
            <div id="demo-output" class="demo-output" role="log" aria-live="polite"></div>
          </div>
        </div>
      </section>

      <!-- Code snippets -->
      <section>
        <h2>Drop into your agent in 5 lines</h2>
        <div class="tabs">
          <button class="tab active" data-group="sdk" data-tab="curl" onclick="switchTab('sdk','curl')">curl</button>
          <button class="tab" data-group="sdk" data-tab="js" onclick="switchTab('sdk','js')">JavaScript</button>
          <button class="tab" data-group="sdk" data-tab="python" onclick="switchTab('sdk','python')">Python</button>
          <button class="tab" data-group="sdk" data-tab="langchain" onclick="switchTab('sdk','langchain')">LangChain</button>
          <button class="tab" data-group="sdk" data-tab="crewai" onclick="switchTab('sdk','crewai')">crewAI</button>
          <button class="tab" data-group="sdk" data-tab="claude" onclick="switchTab('sdk','claude')">Claude Agent SDK</button>
        </div>

        <div class="tab-panel active" data-panel-group="sdk" data-panel="curl">
          <pre><span class="cmt"># Step 1: get the 402 challenge</span>
curl -s -X POST https://api.bitbooth.io/v1/fetch \\
  -H <span class="str">"content-type: application/json"</span> \\
  -d <span class="str">'{"url":"https://example.com","mode":"markdown"}'</span>

<span class="cmt"># Step 2: pay USDC on Base, then retry with proof</span>
curl -s -X POST https://api.bitbooth.io/v1/fetch \\
  -H <span class="str">"content-type: application/json"</span> \\
  -H <span class="str">"x-payment: {nonce,txHash,signature,network}"</span> \\
  -d <span class="str">'{"url":"https://example.com","mode":"markdown"}'</span></pre>
        </div>

        <div class="tab-panel" data-panel-group="sdk" data-panel="js">
          <pre><span class="kw">import</span> { BitBoothClient } <span class="kw">from</span> <span class="str">'@bitbooth/sdk'</span>;

<span class="kw">const</span> client = <span class="kw">new</span> <span class="fn">BitBoothClient</span>({ walletKey: process.env.AGENT_KEY });

<span class="kw">const</span> result = <span class="kw">await</span> client.<span class="fn">fetch</span>(<span class="str">'https://example.com'</span>);
console.<span class="fn">log</span>(result.markdown);</pre>
        </div>

        <div class="tab-panel" data-panel-group="sdk" data-panel="python">
          <pre><span class="kw">from</span> bitbooth <span class="kw">import</span> BitBoothClient

client = <span class="fn">BitBoothClient</span>(wallet_key=os.environ[<span class="str">"AGENT_KEY"</span>])

result = client.<span class="fn">fetch</span>(<span class="str">"https://example.com"</span>)
<span class="fn">print</span>(result.markdown)</pre>
        </div>

        <div class="tab-panel" data-panel-group="sdk" data-panel="langchain">
          <pre><span class="kw">from</span> bitbooth_langchain <span class="kw">import</span> BitBoothFetchTool

<span class="cmt"># Drop into any LangChain agent</span>
tools = [<span class="fn">BitBoothFetchTool</span>(wallet_key=os.environ[<span class="str">"AGENT_KEY"</span>])]

agent = <span class="fn">initialize_agent</span>(
    tools=tools,
    llm=llm,
    agent=AgentType.OPENAI_FUNCTIONS,
)
result = agent.<span class="fn">run</span>(<span class="str">"Summarize https://example.com"</span>)</pre>
        </div>

        <div class="tab-panel" data-panel-group="sdk" data-panel="crewai">
          <pre><span class="kw">from</span> bitbooth_langchain <span class="kw">import</span> BitBoothFetchTool
<span class="kw">from</span> crewai <span class="kw">import</span> Agent, Task, Crew

researcher = <span class="fn">Agent</span>(
    role=<span class="str">"Web Researcher"</span>,
    tools=[<span class="fn">BitBoothFetchTool</span>(wallet_key=os.environ[<span class="str">"AGENT_KEY"</span>])],
    llm=llm,
)

task = <span class="fn">Task</span>(
    description=<span class="str">"Fetch and summarize https://example.com"</span>,
    agent=researcher,
)
<span class="fn">Crew</span>(agents=[researcher], tasks=[task]).<span class="fn">kickoff</span>()</pre>
        </div>

        <div class="tab-panel" data-panel-group="sdk" data-panel="claude">
          <pre><span class="cmt">// Claude Agent SDK — use BitBooth as an MCP server</span>
<span class="cmt">// ~/.claude/config.json</span>
{
  <span class="str">"mcpServers"</span>: {
    <span class="str">"bitbooth-fetch"</span>: {
      <span class="str">"command"</span>: <span class="str">"npx"</span>,
      <span class="str">"args"</span>: [<span class="str">"@bitbooth/mcp-fetch"</span>],
      <span class="str">"env"</span>: { <span class="str">"BITBOOTH_AGENT_KEY"</span>: <span class="str">"your-wallet-key"</span> }
    }
  }
}

<span class="cmt">// Then in Claude Code or Claude Desktop:</span>
<span class="cmt">// "Fetch and summarize https://example.com"</span>
<span class="cmt">// Claude auto-calls the bitbooth-fetch tool, pays, returns markdown.</span></pre>
        </div>
      </section>

      <!-- Features -->
      <section>
        <h2>Built for agents</h2>
        <div class="features">
          <div class="feature">
            <h3>Multi-chain</h3>
            <p>Pay with USDC on Base (EVM) or Solana. One challenge, your agent picks the cheapest route.</p>
          </div>
          <div class="feature">
            <h3>No API keys for payment</h3>
            <p>x402 uses on-chain proof. Fund a wallet, start fetching. Keys optional for rate limits.</p>
          </div>
          <div class="feature">
            <h3>Clean markdown</h3>
            <p>Readability extraction + turndown. No ads, no nav chrome. Ready for LLM context windows.</p>
          </div>
          <div class="feature">
            <h3>2-block confirmation</h3>
            <p>Micropayments settle in seconds. No invoices, no chargebacks, no monthly bills.</p>
          </div>
        </div>
      </section>

      <!-- Pricing -->
      <section>
        <h2>Pricing</h2>
        <div class="pricing-table">
          <div class="price-pill">Pay per request</div>
          <h3>Simple, transparent</h3>
          <div class="big-price">$0.005 <small>per fetch</small></div>
          <ul>
            <li>No minimum commitment</li>
            <li>No monthly subscription required</li>
            <li>Pay only for what you scrape</li>
            <li>Volume discounts available via <a href="/dashboard">custom routes</a></li>
            <li>USDC on Base or Solana — you choose per request</li>
          </ul>
        </div>
      </section>

      <footer>
        Built on the
        <a href="https://github.com/coinbase/x402" rel="noopener noreferrer">x402</a>
        protocol. Payments settled on Base + Solana in USDC.
        <a href="/">obol home</a> · <a href="/docs">docs</a> · <a href="/dashboard">dashboard</a>
      </footer>
    </div>

    <script>${DEMO_JS}</script>
  </body>
</html>
`;
