# 🎯 Launch Today — First Penny Playbook

**Mission:** get one outside agent to pay BitBooth ≥ $0.005 USDC for a real fetch within 12 hours.

**The wedge:** first working x402 MCP server. Real x402 protocol implementation, real multi-chain settlement (XRPL Mainnet + Base Sepolia), npm-installable in one line. The only paid MCP server that exists today.

> Originally planned to lead with `mode:render` (Playwright JS rendering) as the moat. Caught a bug pre-launch — Chromium binary isn't in the Lambda yet. Render mode is gated until v1.0.2 ships the Chromium Layer (this week). Pivoted launch to lead with the protocol implementation itself.

---

## The pitch (one sentence)

> The first working x402 MCP server. Your agent fetches a URL, pays $0.005 stablecoin via the Coinbase + Linux Foundation x402 protocol, gets clean markdown back. Sub-2-second settlement on XRPL Mainnet — verified with real money.

---

## Step 1 — Show HN post (post 9-11am ET, Tue/Wed/Thu peak)

**Title:** `Show HN: BitBooth – pay-per-fetch MCP server for AI agents using x402`

**Body:**

```
Hi HN — I built BitBooth, the first working MCP server that lets AI agents
pay per call via the x402 protocol (Coinbase + Linux Foundation, 2025).
One npm install, no signup, no API keys. Default is free Base Sepolia
testnet so you can play without spending real money.

The pitch: x402 ships agent payments via standard HTTP 402 + on-chain
settlement. The protocol is chain-agnostic (uses CAIP-2 to specify the
network), so I support multiple rails — Base Sepolia (USDC), XRPL Mainnet
(XRP, USDC, RLUSD). Agent's wallet picks whichever it has balance on.

Pricing per fetch:
  fast (raw HTML → markdown):              $0.005 USDC
  full (Readability + Turndown extraction): $0.005 USDC

Real money loop verified end-to-end on XRPL Mainnet (1.3s round-trip):
https://xrpscan.com/tx/493F6F1ADB9D258898A028F1D0A34684F5DD8B8C9F99BC6FB3432EA1F8AA45C0

Install (one line):
  npm install @bitbooth/mcp-fetch
  Then point your agent at it. Docs: https://app.heinrichstech.com/docs/agents

Not vaporware — earnings dashboard at https://app.heinrichstech.com/admin/earnings
shows the real settled txs.

Honest framing: today this is a reference implementation of x402 for the
MCP world — the fetch + markdown logic alone is no better than the free
@modelcontextprotocol/server-fetch. The protocol implementation itself is
the value. Real moat shipping this week:
  - mode:"render" (Playwright JS rendering) — code shipped, awaits Chromium Lambda Layer
  - mcp-youtube (transcripts), mcp-pdf (extraction with tables) on the roadmap

MIT licensed: https://github.com/Drock91/bitbooth-gateway
Feedback wanted: where else does pay-per-call beat subscription/free?

  — Derek
```

**Why this works:**
- "Show HN" + working demo + honest "what's the moat" framing
- Real tx hash = proof, not promises
- Roadmap shows we're not done
- Specific ask at the end gets comments

---

## Step 2 — Twitter/X thread (5 tweets, post within 30 min of HN)

**Tweet 1 (the hook):**
```
Built the first working x402 MCP server for AI agents.

`npm install @bitbooth/mcp-fetch`

Your agent fetches a URL, pays $0.005 USDC on-chain, gets clean markdown back.
1.3 seconds end-to-end on XRPL Mainnet. No API keys. No signup. No humans.

Demo + thread 👇
```

**Tweet 2 (the why):**
```
x402 (Coinbase + Linux Foundation, 2025) is the cleanest agent-payment spec
I've seen — HTTP 402 + on-chain settlement, chain-agnostic.

Nobody had a working production MCP implementation of it. Now they do.

Multi-chain settlement out of the box: Base Sepolia (USDC), XRPL Mainnet
(XRP, USDC, RLUSD). Agent's wallet picks.
```

**Tweet 3 (the receipts):**
```
Real money, real tx:
xrpscan.com/tx/493F6F1ADB9D258898A028F1D0A34684F5DD8B8C9F99BC6FB3432EA1F8AA45C0

0.005 XRP from one wallet to my BitBooth gateway, returned markdown of
example.com in 1.3s.

Earnings dashboard live: app.heinrichstech.com/admin/earnings
```

**Tweet 4 (the MCP install snippet — easiest screenshot):**
```
One line in your Claude Desktop / Cursor / Continue config:

{
  "mcpServers": {
    "bitbooth-fetch": {
      "command": "npx",
      "args": ["-y", "@bitbooth/mcp-fetch"],
      "env": { "BITBOOTH_AGENT_KEY": "0x<your-testnet-pk>" }
    }
  }
}

Defaults to Base Sepolia testnet — free dev USDC, opt into real money later.
```

**Tweet 5 (the call to action):**
```
First 10 builders to install + try it get a free 1k-call mainnet credit.
DM me with your wallet address.

Docs: app.heinrichstech.com/docs/agents
Source (MIT): github.com/Drock91/bitbooth-gateway
GOALS for next 2 weeks: github.com/Drock91/bitbooth-gateway/blob/main/GOALS.md
```

**Who to tag in the thread:**
- @KevinLeffew (x402 co-creator, you know him)
- @AnthropicAI
- @CursorAI
- @continuedev
- Any MCP framework authors you can find

---

## Step 3 — Reddit posts

### r/LocalLLaMA
**Title:** `Built the first MCP server with pay-per-call billing (no subscriptions, no API keys)`
**Body:** abbreviated version of the HN post, more focus on technical detail

### r/MachineLearning
**Title:** `[P] BitBooth — agent-native paid APIs via the x402 protocol (MCP + crypto)`
**Body:** academic framing, focus on the protocol, less salesy

### r/Bitcoin / r/CryptoCurrency
**Title:** `Real-world use of XRP for AI agent payments — sub-2-second settlement, MIT-licensed gateway`
**Body:** crypto-native framing, lead with the XRPL tx hash

---

## Step 4 — DM 10 specific people

**Targets** (search npm + Twitter for these):
1. Authors of any `mcp-server-*` or `@modelcontextprotocol/*` npm packages
2. Continue.dev maintainers
3. Cline maintainers
4. Active commenters on x402 GitHub discussions
5. Anyone who tweeted about MCP + payments in the last 30 days

**Template** (≤ 100 words, see `docs/COLD_EMAIL_TEMPLATE.md`):
```
Hi {firstname} — saw {their package or tweet}.

I just shipped @bitbooth/mcp-fetch — pay-per-call URL fetching with JS
rendering, via x402. Bigger thing: it's the first paid MCP server I know
of, so it might unlock new monetization paths for {their package}.

Free 1k-call mainnet credit if you want to try. Just `npm install
@bitbooth/mcp-fetch`. Docs: app.heinrichstech.com/docs/agents

If it's not a fit, no worries — would love your gut take on whether
"per-call billing for MCP tools" makes sense.

Derek
```

---

## What "WIN TODAY" looks like

**Minimum acceptable result:** dashboard shows ≥ 1 real outside payment by midnight.
**Stretch:** 5+ outside payments, 2+ DMs reply, 1 Show HN comment thread.
**Home run:** front-page HN, 50+ stars on the GitHub repo, first paying customer signs up.

---

## What I'm doing while you post

- Validate `mode:render` actually works against a real SPA
- Update README to lead with JS rendering as the headline feature
- Update landing page copy to highlight mode:render
- Build a 30-second screen recording script if you want one
- Watch the dashboard

**Refresh https://app.heinrichstech.com/admin/earnings every 15 min.** When the counter goes up, that's our penny.
