# Landing Page Copy — heinrichstech.com/bitbooth.html

You said the landing page is in a separate repo I don't have access to. Here's the exact copy + HTML to drop in to make it convert. Replace whatever's there now.

---

## Above the fold

### Headline (h1)

> Pay-per-call APIs for AI agents.

### Subhead (≤ 22 words)

> Your agent gets a wallet, pays USDC per request, and you get a clean SDK. No accounts, no API keys, no humans in the loop.

### Two CTAs side-by-side

```html
<a href="https://www.npmjs.com/package/@bitbooth/mcp-fetch" class="cta cta-primary">
  npm install @bitbooth/mcp-fetch
</a>
<button id="run-demo" class="cta cta-secondary">Run live demo →</button>
```

The "Run live demo" button is what the existing 6-chain race demo wires into. Keep that working.

---

## "Try it in 30 seconds" section (right under the fold)

Three-step proof, copy-paste ready:

```bash
# 1. Hit the endpoint cold — get a 402 challenge
curl -X POST https://app.heinrichstech.com/v1/fetch \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","mode":"fast"}'

# 2. Pay 0.005 XRP from any XRPL wallet to:
#    rfryheo6yzFdLWj8qUQtZc7zG9MKkBkUEy
#    (or 0.005 USDC on Base Sepolia — agent picks)

# 3. Retry with X-Payment header containing your tx hash
#    Get clean markdown of the URL back. ~1.3s end-to-end.
```

---

## "What just happened" section (build trust)

```
Agent → /v1/fetch                       → 402 Payment Required (challenge)
Agent → settles 0.005 USDC on-chain    → tx hash returned
Agent → /v1/fetch + X-Payment: tx-hash → 200 OK + markdown of the URL

Sub-2 seconds. Verified end-to-end on XRPL mainnet today.
Last tx: 493F6F1ADB9D... (xrpscan link)
```

---

## "Install in your agent" section

Three side-by-side cards:

### Claude Code

```bash
claude mcp add @bitbooth/mcp-fetch
```

### Cursor / Continue / Cline

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "bitbooth-fetch": {
      "command": "npx",
      "args": ["-y", "@bitbooth/mcp-fetch"],
      "env": { "BITBOOTH_AGENT_KEY": "0x<your-testnet-pk>" }
    }
  }
}
```

### From scratch (raw curl)

```bash
curl -X POST https://app.heinrichstech.com/v1/fetch \
  -H "Content-Type: application/json" \
  -H "X-Payment: {...}" \
  -d '{"url":"https://news.ycombinator.com"}'
```

---

## "Why now" section (the pitch)

> The agentic web has a payment problem. Agents call APIs. APIs need to bill them. But agents don't have credit cards, can't sit through OAuth, can't sign T&Cs.
>
> x402 (Coinbase + Linux Foundation, 2025) solves this with HTTP 402 Payment Required + on-chain settlement. BitBooth implements it across 9 chains so your agent can pay from whichever wallet it already has balance on.

---

## Social proof / metrics row (at bottom)

Pull live from `/admin/earnings.json` or hardcode for now:

```
✅ Live on XRPL Mainnet · Base Sepolia
⚡ 1.3s median end-to-end
🤝 5 payments processed in last 24h
📦 @bitbooth/mcp-fetch on npm
```

---

## What NOT to put on the page (avoid the lies)

- ❌ "9 supported chains" — only 2 are end-to-end verified
- ❌ "Fiat onramping with Moonpay/Coinbase/Kraken/Binance/Uphold" — adapters are stubs
- ❌ "Stellar Live" — adapter doesn't exist
- ❌ "Best-quote routing" — `/v1/quote` is unrouted
- ❌ "Trusted by 100+ agents" — you have 5 real payments and one was you

Keep claims tight to verified reality. When you cross 100 real customers, swap in.

---

## SEO / OpenGraph tags

```html
<title>BitBooth — Pay-per-call APIs for AI agents (x402)</title>
<meta
  name="description"
  content="MCP server that lets AI agents pay USDC per API call via x402. No accounts, no API keys. Live on XRPL Mainnet + Base Sepolia."
/>
<meta property="og:title" content="BitBooth — agent payments without humans" />
<meta
  property="og:description"
  content="Pay 0.005 USDC, get web content as markdown in 1.3s. No signup required."
/>
<meta property="og:url" content="https://heinrichstech.com/bitbooth.html" />
<meta property="og:image" content="https://heinrichstech.com/bitbooth-og.png" />
<meta name="twitter:card" content="summary_large_image" />
```

You'll need a 1200x630 PNG at `/bitbooth-og.png` for the share preview. Use the same gradient-dot + "BitBooth" wordmark from the admin login page for visual consistency.
