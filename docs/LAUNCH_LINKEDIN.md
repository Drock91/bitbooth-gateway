# LinkedIn Launch Post — BitBooth (demo + roadmap framing)

**Strategic framing:** ship as reference implementation now, build real moat (JS rendering) over next 2 weeks. Don't oversell — the demo is functionally equivalent to the free `@modelcontextprotocol/server-fetch` today. The pitch is the protocol shipping + the roadmap, not "look at this superior product."

Three versions below. **Recommend Version 4 (the demo-honest one).** All claims verified end-to-end on staging.

---

## Version 4 — Demo + roadmap (RECOMMENDED — replaces older versions)

> Shipped: the first working x402 MCP server.
>
> ```
> npm install @bitbooth/mcp-fetch
> ```
>
> Verified end-to-end this afternoon — agent wallet pays 0.005 XRP on XRPL Mainnet (real money) — or 0.005 USDC on Base Sepolia (free testnet) for development, gateway returns the URL as clean markdown, full round-trip in 1.3 seconds.
>
> Honest framing: **the fetch logic itself is no better than the free `@modelcontextprotocol/server-fetch`** today. So why ship it? Because x402 (Coinbase + Linux Foundation, 2025) is the cleanest agent-payment spec I've seen, and nobody had a working production MCP implementation of it. Now they do — and it's MIT, single-file, copy-pasteable.
>
> The next 2 weeks turn the demo into a real product:
> – JS rendering via Playwright (works on SPAs that `server-fetch` can't crawl)
> – Better markdown via Readability + Turndown (cleaner output for LLMs)
> – Shared cache so multiple agents hitting the same URL split the payment
> – Marketplace where third-party API publishers list their own paid endpoints
>
> If you build agent tooling — DM me. First 10 builders to try it get a free 1k-call mainnet trial.
>
> Live demo + admin earnings dashboard: heinrichstech.com/bitbooth.html
> Source + roadmap: github.com/Drock91/bitbooth-gateway
>
> #x402 #AI #Agents #MCP #XRPL #Base

**Length:** ~225 words. Honest about today, exciting about tomorrow.

---

---

## Version 1 — "I built this" (personal voice, recommended for first post)

> 11 months ago Coinbase + the Linux Foundation shipped the x402 spec — a way for AI agents to pay APIs in stablecoin via HTTP 402 Payment Required.
>
> I just shipped **BitBooth** — a multi-chain x402 gateway that lets any AI agent fetch a URL for $0.005 USDC, no signup, no API key.
>
> **Live demo (3 lines, no auth):**
>
> ```bash
> npm install @bitbooth/mcp-fetch
> ```
>
> Add to your Claude Code / Cursor / Continue MCP config and your agent gets a `fetch(url)` tool that pays per call. Settled in 1.3s on XRPL mainnet, verified end-to-end last hour.
>
> Also live: a 6-chain race demo at heinrichstech.com/bitbooth.html
>
> What's working today:
> ✅ x402 V2 protocol — challenge → on-chain pay → markdown back, sub-2s
> ✅ Base Sepolia (USDC) and XRPL Mainnet (XRP) verified end-to-end
> ✅ MCP server on npm: @bitbooth/mcp-fetch
> ✅ Self-service tenant signup + per-route pricing
> ✅ Branded admin console with Grafana-style earnings dashboard
>
> What I'm hunting for next: **agent builders + MCP server authors** who want to bolt paid tools onto their agents without setting up payment infra. DM me — first 10 get a free 1k-call trial.
>
> #x402 #AI #Agents #XRPL #Base #MCP

**Length:** ~210 words. Just under the LinkedIn "see more" fold.

---

## Version 2 — "Here's why this matters" (industry voice, for VC/builder audience)

> The agentic web has a payment problem.
>
> Agents need to call APIs — for data, search, fetch, analysis — and those APIs need to charge them. But agents don't have credit cards, can't sign up for accounts, can't sit through OAuth flows. Today most monetized APIs require a human in the loop, which is the exact opposite of what an agent does.
>
> The x402 protocol (Coinbase + Linux Foundation, 2025) solves this with HTTP 402 Payment Required + on-chain settlement. Server returns 402 → agent pays from its wallet → server returns content. No accounts, no humans, sub-2s end-to-end.
>
> I built BitBooth as a production gateway on this spec. Ship `@bitbooth/mcp-fetch` to npm, point your agent at it, and any LLM that supports MCP (Claude Code, Cursor, Continue, Cline, Windsurf) can fetch any URL for $0.005 — paid in real USDC on Base or real XRP on XRPL mainnet.
>
> Verified end-to-end this afternoon: 0.005 XRP from one wallet → BitBooth verified the on-chain tx → returned clean markdown of example.com in 1.3s. The earnings dashboard ticked up to $0.005.
>
> Not vaporware. Not a thread. A working product on npm, today.
>
> Try it: heinrichstech.com/bitbooth.html
>
> #x402 #Agents #Crypto #XRPL #MCP #AI

**Length:** ~265 words.

---

## Version 3 — "Quick win" (short, viral-shaped, for general feed)

> I just paid an AI tool with crypto.
>
> No subscription. No API key. No human signed anything. My agent's wallet sent $0.005 USDC, the API verified it on-chain, and gave me the page content as markdown. End-to-end: 1.3 seconds.
>
> This is what x402 looks like in practice. Coinbase + Linux Foundation shipped the spec. I shipped a gateway:
>
> npm install @bitbooth/mcp-fetch
>
> Works in any MCP-aware agent. Try the live demo at heinrichstech.com/bitbooth.html
>
> #x402 #AI #Crypto

**Length:** ~85 words. Tight, scannable, share-bait.

---

## Things to add to ANY version before posting

1. **Screenshot of the admin earnings dashboard** showing real payments. People scroll past text. They stop at green dashboards.
2. **Screenshot of an MCP client (Claude Code) actually calling the fetch tool** if you can grab one — that's the proof.
3. **Tag Kevin Leffew** (you connected with him already, x402 co-creator) — he'll likely react/share.
4. **Tag Coinbase + Linux Foundation x402 accounts** if they exist.

## What to expect / brace for

- 30% of comments will ask "isn't this just stripe-but-crypto." Answer: "stripe needs accounts; this needs no accounts. that's the difference."
- 20% will say "but agents don't have wallets." Answer: "Coinbase Smart Wallets, Privy, Crossmint — they do now."
- 10% will ask "so how do I make money on this?" Answer: "host an API, set a price per call, BitBooth handles the rest."
- The other 40% will scroll past. Normal.
