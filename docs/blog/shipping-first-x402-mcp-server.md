# Shipping the First x402 MCP Server

*How I built an AI agent payment gateway from spec to production in 3 weeks — and why the hard part isn't the crypto.*

---

In April 2025, Coinbase and the Linux Foundation published the [x402 protocol](https://www.x402.org/) — a spec for AI agents to pay APIs using HTTP 402 Payment Required. The idea is simple: server returns a 402 with a payment challenge, agent pays on-chain, retries with a proof, gets the content. No accounts. No API keys. No humans in the loop.

I read the spec and thought: someone should build a production implementation of this as an MCP server. MCP (Model Context Protocol) is how Claude, Cursor, Windsurf, and a growing list of AI tools discover and call external tools. If you could combine x402 with MCP, any agent could pay for any API with zero configuration beyond a wallet key.

So I built it. This is the story of what worked, what didn't, and what I learned shipping the first working x402 MCP server to npm.

## The protocol in 30 seconds

Here's what happens when an agent calls BitBooth's `/v1/fetch` endpoint:

```
Agent                         BitBooth                        Blockchain
  |                              |                               |
  |-- POST /v1/fetch ----------->|                               |
  |<-- 402 Payment Required -----|  (nonce, amount, payTo addr)  |
  |                              |                               |
  |-- send USDC on-chain --------|------------------------------>|
  |-- retry with X-Payment ----->|                               |
  |                              |-- verify tx on-chain -------->|
  |                              |<-- confirmed -----------------|
  |<-- 200 OK + markdown --------|                               |
```

The 402 response includes a `challenge` object: a nonce, the recipient address, the asset (USDC), and the amount. The agent signs a transaction, sends it on-chain, then retries with the tx hash in an `X-Payment` header. The server verifies on-chain that the payment landed, checks the nonce for replay protection, and proxies through.

One round-trip. Sub-2 seconds end-to-end.

## Week 1: Making the money actually move

The first real milestone was seeing actual money move. Not testnet tokens — real XRP on XRPL Mainnet. I remember refreshing the [xrpscan explorer](https://xrpscan.com/tx/493F6F1ADB9D258898A028F1D0A34684F5DD8B8C9F99BC6FB3432EA1F8AA45C0) and watching the transaction confirm. 0.005 XRP, 1.3 seconds from request to markdown response.

That tx hash — `493F6F1A…` — is still in the README. It's the proof that this isn't a whitepaper or a "coming soon." It's a deployed gateway accepting real payments today.

Getting there required solving problems that don't show up in the spec:

**Nonce management.** The spec says "include a nonce for replay protection." It doesn't say how to track nonces across Lambda cold starts, handle concurrent requests, or deal with the race where two agents submit payments for the same nonce. I ended up with a DynamoDB table (`agent-nonces`) with atomic increments and a conditional write that rejects duplicates.

**Chain verification latency.** XRPL confirms in 3-5 seconds. Base (Ethereum L2) takes 2-12 seconds depending on block time. The agent is sitting there waiting. I settled on requiring 2 block confirmations for micropayments (under $1) and 12 for anything larger — a tradeoff between speed and finality risk.

**The XRPL `delivered_amount` gotcha.** XRPL transactions can partially fill. If an agent sends 0.005 XRP but the path only delivers 0.004, the `Amount` field says 0.005 but `delivered_amount` says 0.004. The verifier has to check the actual delivered amount, not the requested amount. I found this the hard way when a test payment "succeeded" but the dashboard showed the wrong asset symbol.

## Week 2: Making the fetch worth paying for

Here's the uncomfortable truth I put right in the LinkedIn post: the fetch logic itself was no better than the free `@modelcontextprotocol/server-fetch`. Same URL in, same markdown out. Why would an agent pay $0.005 for something it can get for free?

The answer is: it wouldn't. So I needed a moat.

**Mode 1: `fast`** — raw HTTP fetch, convert HTML to markdown. This is what the free server does. Price: $0.005 USDC. Exists mostly as a baseline.

**Mode 2: `full`** — article extraction using Mozilla's [Readability](https://github.com/mozilla/readability) library, then conversion with [Turndown](https://github.com/mixmark-io/turndown). Strips navbars, sidebars, ads, cookie banners. The output is measurably cleaner for LLM consumption. Same price.

**Mode 3: `render`** — this is the real differentiator. Playwright launches a headless Chromium browser, waits for JavaScript to execute, then extracts the rendered DOM. SPAs built in React, Vue, or Angular that return empty `<div id="root"></div>` to a naive HTTP fetch? `render` mode gets the actual content. Price: $0.02 USDC (4x, because Playwright is expensive to run).

The render mode is what makes paying worthwhile. Any agent trying to fetch a modern dashboard, a JavaScript-rendered documentation site, or a social media profile gets nothing useful from a raw HTTP request. With `render`, they get clean markdown of the fully-rendered page.

## Week 3: Making it production-grade

Shipping a demo is one thing. Shipping something you'd trust with real money is another. The infrastructure layer ended up being more code than the payment logic:

- **10 DynamoDB tables** — tenants, routes, payments, fraud events, nonces, rate limits, idempotency keys, usage tracking, webhook DLQ, and a fetch cache
- **Fraud detection** — velocity rules (too many requests per second), amount bounds (reject suspiciously large payments), nonce failure tracking (too many invalid nonces = blocked)
- **Per-tenant rate limiting** — token bucket algorithm in DDB, plan-based tiers (free: 100/mo, starter: 5k/mo, growth: 50k/mo)
- **Idempotency** — if the agent retries (network blip, Lambda timeout), the second request returns the cached response instead of charging twice
- **Circuit breaker** on the RPC connection — if the blockchain node is down, fail fast instead of hanging for 30 seconds

All of this is wired through AWS CDK: 5 Lambda functions, API Gateway with WAF, CloudWatch alarms, SQS dead-letter queues, and X-Ray tracing. The CDK stack has its own test suite — 400+ assertions verifying IAM grants, table schemas, and alarm thresholds.

Total test count at time of writing: **3,368 passing tests.** That's not a vanity metric — it's what lets an automated system (the "autopilot" that helps me ship) make changes without breaking payment flows. When your code handles real money, every edge case matters.

## What I got wrong

**I built exchange adapters I didn't need.** Five of them — Moonpay, Coinbase, Kraken, Binance, Uphold — all stubs that never made real API calls. The idea was "agents will want to buy crypto through BitBooth." The reality is that agents already have wallets with balances. They don't need an onramp. Those 5 adapter directories are still in the repo, scheduled for deletion.

**I overbuilt the multi-chain story.** The README lists 8 chains. Only 2 actually work end-to-end: XRPL Mainnet (real money) and Base Sepolia (testnet). Solana and XRPL EVM have adapter code but aren't wired into the challenge builder. Honesty matters more than an impressive-looking table.

**I underestimated cold starts.** The render Lambda bundles Playwright + Chromium. Cold start: 8-12 seconds. Warm: 2-3 seconds. For a service that charges per call, making the customer wait 12 seconds on the first request is rough. I'm exploring provisioned concurrency, but at $0.02 per call, the economics are tight.

## The business case (honest version)

The revenue math is straightforward:

- 1 active agent at 1,000 calls/day x $0.005 = **$5/day = $150/month**
- 10 agents = **$1,500/month**
- 100 agents = **$15,000/month**

Getting to 100 active agents requires two things: more tools worth paying for (YouTube transcripts, PDF extraction, web search), and discovery (MCP Registry listing, dev community posts, word of mouth).

The moat is narrow today. `render` mode is genuinely useful, but someone could replicate it in a weekend. The deeper moat — the one I'm building toward — is a marketplace where third-party API publishers list paid endpoints through BitBooth. One gateway, many tools, agents pay once per call regardless of who built the backend.

## Try it

The gateway is live at `app.heinrichstech.com`. The MCP server is on npm:

```bash
npm install @bitbooth/mcp-fetch
```

Add it to your Claude Code / Cursor / Windsurf config:

```json
{
  "mcpServers": {
    "bitbooth-fetch": {
      "command": "npx",
      "args": ["-y", "@bitbooth/mcp-fetch"],
      "env": {
        "BITBOOTH_AGENT_KEY": "0x<your-wallet-private-key>"
      }
    }
  }
}
```

Default chain is Base Sepolia (testnet, free money). Your agent gets a `fetch` tool that pays per call. For real-money payments on XRPL Mainnet, set `BITBOOTH_CHAIN_ID=xrpl:0`.

Source, roadmap, and all 3,368 tests: [github.com/Drock91/bitbooth-gateway](https://github.com/Drock91/bitbooth-gateway)

---

*Built by [Daniel Heinrich](https://heinrichstech.com). The x402 protocol is from the [x402 Foundation](https://www.x402.org/) (Coinbase + Linux Foundation). BitBooth is MIT-licensed and not affiliated with either organization.*
