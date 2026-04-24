# BitBooth Goals

> Source of truth for the autopilot. Each goal has an ID, status, and acceptance criteria. The autopilot reads this file every tick and picks the highest-priority `pending` goal it can finish.

## 💰 The single lens for goal selection: REVENUE

Everything in this file maps to one of these five revenue levers:

1. **More paying calls** — ship a new paid endpoint agents will pay for; ship/promote MCP packages; submit to MCP Registry, awesome-mcp, HN; cold-email agent builders
2. **Higher price per call** — moats (JS rendering, table extraction, anti-bot, caching) that justify higher pricing tiers
3. **Lower cost per call** — caching, rate-limit pooling, cheaper upstream APIs, materialized rollups
4. **Lower churn risk** — admin TOTP, observability, tenant-facing features
5. **Unblock #1-#4** — bug fixes, security, infra reliability, doc clarity

**If a goal doesn't map to one of those five, it doesn't go in this file.**

### How we actually make money — the math

Anthropic does NOT have a third-party billing API. "Claude tokens" as a payment rail isn't a thing. Don't waste ticks on it. **The play is x402: get agents to pay us per-call in USDC/XRP. That's the entire game.**

Revenue math:
- 1 active agent at 1000 calls/day × $0.005 = **$5/day = $150/mo**
- 10 active agents = **$1,500/mo**
- 100 active agents = **$15,000/mo**
- 1,000 active agents = **$150,000/mo**

**To get to 100 active agents** we need:
1. **More tools they NEED to install us for** — every additional paid endpoint (mcp-youtube, mcp-pdf, mcp-search, mcp-ocr) is another wedge into an agent stack
2. **Higher-value tools they pay more for** — JS rendering @ $0.02, PDF extraction @ $0.02, transcription @ $0.05/min compounds the per-call revenue
3. **Discovery** — MCP Registry, awesome-mcp lists, HN, devs telling other devs
4. **Friction-free install** — `npm install` + one env var, then it just works

**Strategy:** demo today → ship 2 microservices + JS rendering moat in 2 weeks → first paying customers in 4 weeks → marketplace in 90 days. See `.agent/CLAUDE_LOOP.md` for full mission.

**Status legend (dashboard-parseable):** `open` | `in_progress` | `done` | `blocked`

## Goal table (parsed by the dashboard at http://localhost:4020)

| Goal | P | Status | Est | Title |
|---|---|---|---|---|
| G-001 | P0 | done | 30m | Earnings dashboard testnet/mainnet toggle (autopilot completed) |
| G-002 | P0 | done | 60m | Reframe README + mcp-fetch + LinkedIn as honest demo |
| G-003 | P0 | blocked | 5m | Smoke-test npm v1.0.1 install (needs user `npm publish` 2FA) |
| G-004 | P0 | done | 90m | Build /docs/agents agent-onboarding page |
| G-010 | P1 | done | 240m | mode:render via Playwright (JS rendering — the real moat) |
| G-011 | P1 | done | 60m | Replace naive html→md with Readability+Turndown |
| G-012 | P1 | in_progress | 180m | DDB-backed shared cache — pricing + per-route TTL shipped, settlement + dashboard stat TBD |
| G-013 | P1 | open | 240m | Per-tenant rate-limit pooling — make plan tiers matter |
| G-020 | P2 | blocked | 5m | Submit to MCP Registry (needs user GitHub OAuth) |
| G-021 | P2 | blocked | 60m | Cold-email 10 MCP authors (needs user to send) |
| G-022 | P2 | done | 90m | Blog post: Shipping the first x402 MCP server |
| G-023 | P2 | open | 30m | Add 30s screencast or GIF to README hero |
| G-024 | P2 | open | 30m | Submit to directories (HN, Product Hunt, awesome-mcp) |
| G-030 | P3 | done | 60m | Delete 5 stub exchange adapter directories |
| G-031 | P3 | open | 180m | TOTP 2FA on admin console |
| G-032 | P3 | done | 30m | Split admin.controller.js (624 lines into 5 files) |
| G-033 | P3 | open | 120m | Materialize daily earnings rollup table |
| G-034 | P3 | open | 180m | Real Moonpay adapter (replace stub) |
| G-035 | P3 | done | 60m | Wire Solana + XRPL-EVM into buildChallenge |
| G-040 | P3 | open | 600m | Marketplace MVP for third-party API publishers |
| G-041 | P3 | open | 240m | Native XRPL signing in @bitbooth/mcp-fetch |
| G-042 | P3 | open | 240m | Lightning Network (L402) adapter |
| G-050 | P1 | open | 480m | Ship @bitbooth/mcp-youtube — paid YouTube transcript MCP |
| G-051 | P1 | open | 720m | Ship @bitbooth/mcp-pdf — paid PDF→markdown w/ tables |
| G-052 | P2 | open | 480m | Ship @bitbooth/mcp-search — paid web search (Brave proxy) |
| G-053 | P2 | open | 480m | Ship @bitbooth/mcp-onchain — multi-chain wallet/tx queries |
| G-054 | P2 | open | 480m | Ship @bitbooth/mcp-ocr — image URL → extracted text |
| G-055 | P3 | open | 480m | Ship @bitbooth/mcp-transcribe — audio/video → text (Whisper) |

---

## Detailed acceptance criteria

Each goal below has full acceptance contract — what the autopilot uses to know "done." When status changes, update BOTH the table above AND the section below.

---

## P0 — Ship the demo + the path to revenue (this week)

### G-001a — Admin earnings dashboard: testnet vs mainnet toggle (no data lies)
**Status:** done
**Why:** today the dashboard sums Base Sepolia (testnet, fake money) and XRPL Mainnet (real money) into one "earnings" figure. Users + the founder see "$0.025 earned" but only ~$0.003 of that is real. Misleading for revenue tracking AND for any future pitch deck.
**Acceptance:**
- Top-right toggle in `/admin/earnings`: `[ Real money ]  [ Testnet ]  [ All ]` (default = Real money)
- Real-money mode filters out networks with `isTestnet: true` (Base Sepolia, XRPL Testnet)
- Header KPI changes label: "Real revenue (XRPL Mainnet + Base Mainnet)" vs "Testnet activity (dev only)"
- `byChain[]` rows show a small badge `TESTNET` next to testnet rows
- `/admin/earnings.json` accepts `?mode=real|testnet|all` query param; default is `real`
- README earnings claims updated to use `real` filter only

### G-001b — Build a public agent-onboarding docs page at app.heinrichstech.com/docs/agents

**Status:** in-progress (interactive engineer is on this)
**Why:** anyone discovering us via MCP Registry / npm needs ONE page that gets them from zero to "my agent just paid for a fetch." Today the gateway has `/docs` mapped but it's stale or empty.
**Acceptance:**
- `GET /docs/agents` returns an HTML page with: 30-second install, env vars, troubleshooting, link to MCP Registry entry, link to GitHub
- Page is mobile-responsive, dark mode, BitBooth-branded
- Includes copy-paste config snippets for Claude Desktop, Claude Code, Cursor, Continue
- Includes the SMOKE_TEST.md flow inline
- Linked from `/`, README, and the npm package README
- Lighthouse perf score >85

### G-002 — Reframe README + mcp-fetch README + LinkedIn post as honest demo
**Status:** done (commit 526c8c8 + follow-up)
**Why:** product framing was overselling. Pivot to "first working x402 reference impl" + "moat shipping in 2 weeks."

### G-003 — Smoke test the npm v1.0.1 install path from a fresh dir
**Status:** needs-user (requires user to `npm publish` first)
**Why:** v1.0.1 is bumped but not published yet. Once user 2FAs the publish, autopilot can verify a fresh install works.

---

## P1 — Build the moat (next 7-14 days, the JS rendering thesis)

### G-010 — Add `mode: "render"` that uses Playwright for JS-rendered pages
**Status:** done (render service, schema, controller, pricing, tests, READMEs all shipped; SPA validation is a staging-deploy activity)
**Why:** the differentiator over `@modelcontextprotocol/server-fetch`. Lets agents fetch SPAs (React/Vue/Angular dashboards) that naive HTTP fetch can't crawl.
**Acceptance:**
- New `mode: "render"` flag in `/v1/fetch` schema
- Lambda deploys with Playwright Chromium bundled (or invokes a separate render-Lambda — measure cold-start tradeoff)
- Tested against 3 SPA targets (twitter.com, linkedin.com profile public view, vercel.com dashboard)
- Returns extracted markdown after JS execution
- README + mcp-fetch README updated to advertise the new mode
- Pricing for `render` mode: 0.02 USDC (4× the price of `fast` — Playwright is expensive)

### G-011 — Replace naive html→markdown with Readability + Turndown pipeline
**Status:** done (shipped in G-201 fetch service: @mozilla/readability + turndown + linkedom, mode: "full")
**Why:** quality moat. Article-extraction + cleaner markdown gives noticeably better LLM input than raw conversion.
**Acceptance:**
- `mode: "full"` switches from current naive impl to `@mozilla/readability` → `turndown`
- Tested against 5 article URLs (NYT, Substack, Medium, Wikipedia, blog)
- Output measurably better than current `mode: "fast"` (manual review acceptable)

### G-012 — DDB-backed shared cache so multiple agents fetching the same URL split the payment
**Status:** in_progress (cache-aware pricing + per-route TTL shipped; remaining: settlement logic, dashboard stat)
**Why:** dramatically improves unit economics for agents (and for us, since we still get paid by each one). N agents hitting the same URL within TTL pay 0.005 / N each.
**Acceptance:**
- New `fetch-cache` DDB table with TTL
- `/v1/fetch` checks cache first; if hit and fresh, returns content + a note that payment is shared
- Settlement: each subsequent payer's USDC goes to the same destination but only the first payer's tx is treated as primary
- TTL configurable per route, default 5 min
- Earnings dashboard shows "shared fetch" stat

### G-013 — Add per-tenant rate-limit pooling so plan tiers actually mean something
**Status:** pending
**Why:** Free/Starter/Growth/Scale plans exist in code but don't gate anything visible. If we want to upsell, plans must matter.
**Acceptance:**
- Free: 100 fetches/mo
- Starter ($49/mo): 5k fetches/mo + Playwright render included
- Growth ($99/mo): 50k fetches/mo + cache write priority
- Scale ($299/mo): 500k fetches/mo + dedicated rate-limit pool
- Stripe checkout wired for plan upgrades
- Admin dashboard shows MRR by plan

---

## P2 — Marketing + discovery (parallel with moat work)

### G-020 — Submit `@bitbooth/mcp-fetch` to MCP Registry
**Status:** needs-user (requires user GitHub OAuth via `mcp-publisher login`)

### G-021 — Cold-email 10 MCP server authors offering free trial credits
**Status:** needs-user (autopilot can DRAFT individual emails using `docs/COLD_EMAIL_TEMPLATE.md`, but user must SEND from their own account)

### G-022 — Write blog post: "Shipping the first x402 MCP server"
**Status:** done
**Acceptance:** ~1500 words, published as a Markdown file in `docs/blog/`. Story = the protocol journey + honest moat plan + tx-hash proof points. Cross-post to dev.to + Hashnode + heinrichstech.com.
**Result:** `docs/blog/shipping-first-x402-mcp-server.md` — ~1,500 words covering the protocol, week-by-week build narrative, tx hash proof points (XRPL `493F6F1A…` + Base Sepolia `0x97aed0…`), honest moat assessment, revenue math, and install instructions. Ready for cross-posting (user action).

### G-023 — Add a 30-second screencast / animated GIF to the README hero
**Status:** pending
**Acceptance:** GIF or short MP4 showing: open Claude Desktop → install BitBooth → ask agent to fetch a URL → see it pay → see markdown back. Hosted in repo or Cloudinary.

### G-024 — Submit BitBooth to relevant directories
**Status:** pending
**Acceptance:** PR/listing on:
- modelcontextprotocol.io community servers
- alternativeto.net
- producthunt.com (queue for next Tuesday launch)
- hackernews "Show HN" thread
- awesome-mcp lists on GitHub

---

## P3 — Tech debt + polish

### G-030 — Delete the 5 stub exchange adapter directories
**Status:** done (stubs already deleted in prior ticks; routing.service.js cleaned up)
**Why:** dead code. Currently labeled as "scaffold" but it's just confusion. Pure deletion + remove imports from routing.service.js.

### G-031 — TOTP 2FA on admin console
**Status:** pending
**Why:** admin can suspend tenants + see all revenue. Password-only is weak.
**Acceptance:** `/admin/2fa/setup` shows QR, recovery codes generated, login enforces TOTP after enrollment.

### G-032 — Split `admin.controller.js` (624 lines) into 5 files
**Status:** done
**Why:** violated `CLAUDE.md` "Files > 300 lines get split" rule.
**Acceptance:** `admin.shared.js` (61 lines), `admin.login.controller.js` (155 lines), `admin.tenants.controller.js` (206 lines), `admin.metrics.controller.js` (93 lines), `admin.password.controller.js` (138 lines). All imports updated, all 160 admin tests pass.

### G-033 — Materialize daily earnings rollup table
**Status:** pending
**Why:** `earnings.service.js` does a full DDB scan every dashboard load. Fine until ~100k payments/mo.
**Acceptance:** new `payments-rollup-daily` table fed by DDB Streams. Earnings dashboard uses rollup, falls back to scan only for "recent payments" list.

### G-034 — Real Moonpay adapter (replace stub)
**Status:** pending (needed before re-enabling /v1/quote)
**Why:** if we want to advertise fiat onramp, ONE real exchange must work. Moonpay has the cleanest API.
**Acceptance:**
- Real HTTP calls to `api.moonpay.com/v3/currencies/...`
- Zod-validated response
- Real Moonpay API key in AWS Secrets Manager (user-provided)
- Re-route POST `/v1/quote`
- Smoke-tested with `curl /v1/quote` returning a quote whose `cryptoAmount` matches Moonpay's website within 1%

### G-035 — Solana + XRPL-EVM into `buildChallenge`
**Status:** done (all chain adapters registered in chainRouter; buildChallenge includes Solana + XRPL options when configured)
**Why:** README claims they're "adapter ready, not yet wired." Wire them so the next launched chain is a 5-line change instead of a multi-day project.

---

## P4 — Stretch / future

### G-040 — Marketplace MVP: third-party API publishers list paid endpoints through BitBooth
**Status:** pending (90-day target)
**Why:** the actual long-term thesis. Today every paid call goes to the user's wallet. Marketplace = anyone can list an endpoint, earn revenue minus platform fee.

### G-041 — Native XRPL signing in `@bitbooth/mcp-fetch`
**Status:** pending
**Why:** today the npm package only signs EVM payments. XRPL is faster + cheaper. Native XRPL signing makes XRP the default for cost-conscious agents.

### G-042 — Lightning Network (L402) adapter
**Status:** pending
**Why:** sub-second settlement, bitcoin-native. Big audience overlap with crypto-curious dev community.

---

## How to add a new goal

When the autopilot or human adds a new goal:
1. Pick the next G-XXX ID in sequence (don't reuse).
2. Set `Status: pending`.
3. Write 1 sentence on `Why` (the user-visible reason this matters).
4. Write 2-5 bullet `Acceptance:` criteria. Concrete, falsifiable.
5. Place under the right tier (P0 ship-blockers, P1 moat, P2 marketing, P3 tech debt, P4 stretch).
6. Don't make goals bigger than ~25 minutes of focused work — split if larger.

If the autopilot completes a goal:
- Move status to `done`.
- Add a CHANGELOG entry referencing the goal ID.
- If the work spawned follow-up tasks, add them as new goals.
