import { LANDING_CSS } from './landing.css.js';

const DEMO_SIGNUP_JS = `
async function obolDemoSignup(ev) {
  ev.preventDefault();
  var email = document.getElementById('demo-email').value.trim();
  var result = document.getElementById('demo-result');
  result.className = '';
  result.textContent = 'Creating your demo key…';
  try {
    var res = await fetch('/demo/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email })
    });
    var data = await res.json();
    if (!res.ok) {
      result.className = 'err';
      result.textContent = data.error || 'Signup failed. Please try again.';
      return false;
    }
    result.className = 'ok';
    result.innerHTML =
      'Key created. Save it now — we will never show it again.<br>' +
      '<code>' + data.apiKey + '</code><br>' +
      'Try it: <a href="/docs">/docs</a> · Manage: ' +
      '<a href="/dashboard?accountId=' + data.accountId + '">/dashboard</a>';
  } catch (err) {
    result.className = 'err';
    result.textContent = 'Network error. Please try again.';
  }
  return false;
}
`;

export const LANDING_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Obol — Stripe for AI agents, built on x402</title>
    <meta name="description" content="HTTP 402 Payment Required, settled on Base in USDC. Drop-in middleware for charging AI agents per request." />
    <style>${LANDING_CSS}</style>
  </head>
  <body>
    <div class="wrap">
      <header>
        <span class="mark">obol</span>
        <nav>
          <a href="/docs">docs</a>
          <a href="/openapi.yaml">openapi</a>
          <a href="/dashboard">dashboard</a>
        </nav>
      </header>

      <h1>Stripe for AI agents.</h1>
      <p class="tagline">
        HTTP 402 Payment Required, settled on Base in USDC. Drop one middleware into
        your API and start charging agents and machines per request.
      </p>

      <div class="cta-row">
        <a class="btn btn-primary" href="#demo">Get a free demo key</a>
        <a class="btn btn-ghost" href="/docs">Read the docs</a>
      </div>

      <section>
        <h2>How it works</h2>
        <ol class="steps">
          <li>Your API returns <strong>402 Payment Required</strong> with a signed x402 challenge.</li>
          <li>The agent sends USDC on Base, includes the payment proof in the retry.</li>
          <li>We verify on-chain in 2 blocks, you fulfill the request. No invoices, no chargebacks, no accounts.</li>
        </ol>
      </section>

      <section class="panel" id="demo">
        <h2>Claim a demo API key</h2>
        <form class="demo" onsubmit="return obolDemoSignup(event)">
          <label for="demo-email">Where should we send follow-ups?</label>
          <input id="demo-email" type="email" name="email" required autocomplete="email" placeholder="you@company.com" />
          <button class="btn btn-primary" type="submit">Get my key</button>
          <div id="demo-result" role="status" aria-live="polite"></div>
        </form>
      </section>

      <section>
        <h2>Pricing</h2>
        <div class="tiers">
          <div class="tier">
            <h3>Starter</h3>
            <div class="price">$49/mo</div>
            <ul><li>10k paid calls</li><li>1 route</li><li>Email support</li></ul>
          </div>
          <div class="tier">
            <h3>Growth</h3>
            <div class="price">$99/mo</div>
            <ul><li>100k paid calls</li><li>Unlimited routes</li><li>Priority support</li></ul>
          </div>
          <div class="tier">
            <h3>Scale</h3>
            <div class="price">$299/mo</div>
            <ul><li>1M paid calls</li><li>Usage-based overage</li><li>SLA + dedicated Slack</li></ul>
          </div>
        </div>
      </section>

      <footer>
        Built on the
        <a href="https://github.com/coinbase/x402" rel="noopener noreferrer">x402</a>
        protocol. Running on Base USDC. © 2026 obol.
      </footer>
    </div>

    <script>${DEMO_SIGNUP_JS}</script>
  </body>
</html>
`;
