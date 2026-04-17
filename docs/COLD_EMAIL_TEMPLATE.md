# Cold Email Templates — BitBooth

Three templates, three audiences. All under 100 words because nobody reads long cold email.

---

## Target A — MCP server authors on npm

**Find them:** search npm for `mcp-server-*` and `@modelcontextprotocol/*`. Pick maintainers of servers that wrap public APIs (search, fetch, scrape, screenshot, news).

**Subject:** `your <package-name> + per-call pricing`

> Hi {firstname} —
>
> Saw {package-name} on npm. Beautiful work.
>
> I built BitBooth — an x402 gateway that lets MCP servers charge per call without setting up Stripe / accounts / OAuth. Agent's wallet pays USDC on Base or XRPL mainnet, settles in <2s, you get a webhook + a dashboard showing earnings.
>
> Want to try wrapping {package-name} with it? I'll set you up with $50 of free demo credits and walk you through wiring it in (~30 min). If it doesn't feel like a win, no harm done.
>
> Live demo: heinrichstech.com/bitbooth.html
>
> Derek

**Why it works:** specific (their package by name), short, low-commitment ask ("try it"), free credits remove friction.

---

## Target B — Agent framework / orchestrator builders

**Find them:** LangChain contributors, AutoGPT forks, Cursor's Composer team, Cline maintainers, Continue.dev team. Anyone shipping an LLM client that does "tools."

**Subject:** `paid tools for {framework}`

> {firstname} —
>
> Quick one. {framework} agents can call tools, but every paid tool today needs a human-issued API key in the env. Hard to scale, hard to bill.
>
> I built BitBooth — agents pay per tool-call in stablecoin (x402 protocol from Coinbase + Linux Foundation). No env vars, no signup. The wallet pays, the tool runs.
>
> Already on npm as @bitbooth/mcp-fetch. Want to add a one-line "paid tools" section to {framework} docs? I'll do the integration writeup, you ship the docs PR.
>
> 30-min call this week?
>
> Derek

**Why it works:** frames as "you publish, I do the work." Distribution play, not sales pitch.

---

## Target C — Crypto-native devs / x402-curious

**Find them:** GitHub stars on `coinbase/x402` repo. Anyone tweeting about x402 in Apr-Jun 2025. XRPL grant recipients. Base ecosystem builders.

**Subject:** `x402 in production — would love your feedback`

> {firstname} —
>
> Built a multi-chain x402 gateway. Live at heinrichstech.com/bitbooth.html. Verified end-to-end on Base Sepolia (USDC) and XRPL mainnet (XRP) — sub-2s settlement.
>
> Not asking you to use it (yet). Just asking: where does the agent-payments thesis still feel weak to you? What did Coinbase miss in the spec? What rails do you want next?
>
> 15 min on Zoom this week — I'll buy your time in coffee at any meeting place if you're in NYC.
>
> Derek

**Why it works:** asks for advice, not money. Crypto natives love being asked their opinion. Coffee bribe seals it.

---

## Sending tips

- **Send between 7-9am their time, Tue-Thu.** Highest open rates.
- **One follow-up after 4 days** if no reply: subject becomes `Re: <original>` and body is one line: "bumping this in case it slipped — Derek"
- **Stop after the second touch.** If they didn't reply to two short emails, they're not interested today. Move on.
- **Track:** simple Google Sheet — name, email, sent date, replied?, outcome. After 50 sends you'll see your real conversion.

## Realistic conversion math

- 10 sends → 3 opens → 1 reply → 0-1 trial sign-up
- 50 sends → 15 opens → 5 replies → 2-3 trial sign-ups
- 200 sends → 60 opens → 20 replies → 8-12 trial sign-ups

**The actual revenue play:** of those 8-12 trial users, 1-2 stick. Each does 1k calls/mo at $0.005 = $5/mo. So 200 cold emails → ~$10/mo recurring. **Sounds tiny, but it's the ceiling — most cold-email startups never hit even that.** Compounds with each batch.

If a single MCP framework integrates BitBooth as default-paid-fetch, that's 1000s of users in one PR — much higher leverage than cold email.
