# Changelog

All notable changes to the BitBooth payment gateway are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- G-001a: Earnings dashboard testnet/mainnet toggle — Real money / Testnet / All filter with `?mode=` query param on `/admin/earnings.json`, TESTNET badges on chain rows, mode-aware KPI labels (31 new tests, 3337 total)
- G-010: Playwright JS rendering via `mode: "render"` on `/v1/fetch` — render service with browser singleton, Readability extraction of rendered content, 4× pricing ($0.02 USDC), Lambda bumped to 2048 MB / 30s timeout, 34 new tests (3368 total)

### Changed

- G-011: Marked done — Readability + Turndown pipeline already shipped in G-201 (`mode: "full"` in `/v1/fetch`)
- G-032: Split monolithic `admin.controller.js` (624 lines) into 5 focused files: `admin.shared.js`, `admin.login.controller.js`, `admin.tenants.controller.js`, `admin.metrics.controller.js`, `admin.password.controller.js`. All 160 admin tests pass, all imports updated

## [1.0.0] - 2026-04-17

First public release. Repository moved from `Drock91/BitBooth` (private) to `Drock91/bitbooth-gateway` (public, MIT).

### Added

- `@bitbooth/mcp-fetch@1.0.0` published to npm — MCP server agents can install in one command
- BitBooth-branded admin console at `app.heinrichstech.com/admin` with 4 pages (Tenants, Metrics, Earnings, Password) sharing a unified gradient brand bar
- Grafana-style earnings dashboard with KPI panels, 24h hourly sparkline (Chart.js), per-chain / per-agent / per-resource breakdowns, recent payments table with explorer links
- Self-service admin password rotation (`/admin/change-password`) with show/hide toggles, 12-char minimum, secret-cache invalidation
- Stage-prefix helper so all redirects + form actions + nav links work correctly via the API Gateway stage URL
- `examples/` folder: bare curl, Node EVM payment, Node XRPL payment, MCP config, LangChain integration
- `SMOKE_TEST.md` — 30-second user-side install verification
- `docs/LAUNCH_LINKEDIN.md`, `docs/COLD_EMAIL_TEMPLATE.md`, `docs/MCP_REGISTRY_SUBMIT.md`, `docs/LANDING_PAGE_COPY.md`

### Changed

- README rewritten to be honest: only chains with verified end-to-end payments get a green checkmark; stub adapters explicitly labelled as scaffold
- Default `BITBOOTH_API_URL` in `@bitbooth/mcp-fetch` switched from raw API GW URL to `https://app.heinrichstech.com`
- `x402-client.js` now translates ethers errors into actionable messages (insufficient ETH, no USDC, etc.) so end users get faucet links instead of stack traces
- XRPL adapter now returns `assetSymbol` from `delivered_amount` so the dashboard shows the actual paid asset (XRP / USD-IOU / RLUSD), not the route default
- Custom domain `app.heinrichstech.com` wired across staging — admin + product paths all use it

### Fixed

- `/v1/quote` was returning 502 because IAM grants were missing AND because the 5 exchange adapters (Moonpay/Coinbase/Kraken/Binance/Uphold) are stubs that don't make real HTTP calls. **Endpoint unrouted entirely** until a real adapter ships
- Five admin pages (`GET /admin`, `POST /admin/login`, `GET /admin/logout`, `/admin/tenants/ui`, `/admin/metrics/ui`) were defined in `dashboard.handler.js` but never wired through API Gateway — now properly routed
- Dashboard handler was silently swallowing errors with a generic 500 — now logs the full err + stack and routes 401s to a 303 redirect to `/admin`
- Dashboard Lambda was missing `secretsmanager:GetSecretValue` on `admin-api-key-hash` and `dynamodb:*Item` on `fraud-events` / `fraud-tally` — added grants
- `FraudEventType` Zod enum was missing `admin.listTenantsUI`, `admin.viewMetrics`, `admin.changePassword` — was causing 500s on every admin HTML page after a real audit-log write
- Earnings dashboard was labelling XRPL payments as "USDC" because middleware was recording `route.assetSymbol` instead of the actually-delivered asset
- xrpl.js v4 nests signed-tx fields under `tx_json`; verifier was looking at root and rejecting valid txs as `invalid-tx-shape`
- `wrapXrplVerify` only included IOU options in `allowed[]` when issuers were configured, dropping the native-XRP option — was rejecting legitimate XRP payments as `amount-mismatch`

### Removed

- All public references to fiat onramping (`Moonpay/Coinbase/Kraken/Binance/Uphold`) — adapters left in `src/adapters/` as scaffolds for future work, but `/v1/quote` is unrouted, exchange secrets no longer granted to apiFn, README + openapi + landing page no longer claim it works

### Security

- Rotated staging admin password
- Documented that `BITBOOTH_AGENT_KEY` should be a dedicated wallet, never a personal one
- Default install spends free testnet money; mainnet requires explicit `BITBOOTH_CHAIN_ID=8453` opt-in with a stderr warning banner

### Verification

- Full money loop verified end-to-end on real XRPL Mainnet (tx `493F6F1ADB9D258898A028F1D0A34684F5DD8B8C9F99BC6FB3432EA1F8AA45C0`, 1.3s round-trip)
- Race demo verified on Base Sepolia (tx `0x97aed08b594e5fbd8e3f71bb1fc01ac3100994da63ae1513906e9136c7ce7d24`)
- 3,306 unit tests passing

## [0.7.0] - 2026-04-09

### Added

- CloudWatch Dashboard with 8 metric widgets: Lambda errors, API latency, DDB throttles, payment counts (G-122)
- AWS WAF WebACL with AWSManagedRulesCommonRuleSet and KnownBadInputs on API Gateway (G-121)
- Per-account plan-based rate limiting on GET /v1/payments (G-120)
- Per-account plan-based rate limiting on POST /v1/quote (G-119)
- CSP `default-src 'none'` header on all JSON API responses (G-118)
- Point-in-time recovery on Idempotency, FraudEvents, and FraudTally DDB tables (G-117)

### Changed

- Split `infra/stacks/x402.stack.js` (541 lines) into 5 CDK Construct sub-modules (G-116)

## [0.6.0] - 2026-04-07

### Added

- OpenAPI request/response examples on all 14 endpoints, reusable 402/404/500 error responses, spec v0.6.0 (G-113)
- API Gateway 4xx alarm and Lambda P99 duration alarms for latency regression detection (G-112)
- `cd-prod.yml` GitHub Actions workflow: manual approval gate, CDK deploy prod, smoke test (G-111)
- Integration tests for webhook DLQ sweep lifecycle with LocalStack DDB (G-110)
- HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy security headers on all responses (G-109)
- Ops runbook (`docs/RUNBOOK.md`): alarm response, DLQ triage, secret rotation, tenant suspension (G-114)
- Integration tests for admin tenant listing: pagination, plan filtering, cursor encoding (G-103)
- GET /admin/tenants documented in openapi.yaml with AdminKeyAuth scheme (G-095)

### Changed

- Excluded `adapters/types.js` from vitest coverage; covered xrpl-evm/client.js null blockNumber branch (G-108)

### Fixed

- `http.js` branch coverage to 100%: non-abort fetch error re-throw path (G-107)
- `webhook.handler.js` and `admin.controller.js` branch coverage to 100% (G-105, G-106)
- `webhook-dlq.service.js` branch coverage: exhausted retries, backoff skip, pagination loop (G-104)
- Dashboard controller branch coverage for putRoute/deleteRoute/getRoutes error paths (G-097)

### Tests

- 53 tests for `templates.js`: escapeHtml, renderPage, renderDashboard at 100% coverage (G-096)
- Reusable smoke-test workflow wired into cd-staging (G-099)
- `npm run validate:openapi` script comparing spec paths vs code routes, 26 tests (G-100)
- Per-IP rate limiting on GET /admin/tenants, 30/hr default (G-101)
- `config.js` cold-start self-test logging warnings for 9 missing optional env vars (G-102)
- GitHub Actions CD workflow for staging deployment (G-098)

## [0.5.0] - 2026-04-06

### Added

- GET /admin/tenants endpoint with cursor pagination, plan filter, admin key auth (G-093)
- ADMIN_API_KEY_HASH via Secrets Manager, /admin/tenants API GW route (G-094)
- Scheduled webhook DLQ retry sweep with exponential backoff, 5th Lambda, EventBridge 5-min rule (G-091)
- k6 load test script for /v1/quote and /v1/resource performance baselines (G-092)
- Dependabot configuration for weekly npm dependency updates (G-089)
- `--strict` flag on smoke-test.js: fails on degraded /v1/health/ready (G-090)
- Adapter retry utility (`src/adapters/retry.js`) with exponential backoff and jitter (G-079)
- SQS dead-letter queues on webhookFn and stripeWebhookFn, 14-day retention, 2 CW alarms (G-078)
- Lambda reserved concurrency: apiFn 100 prod/5 dev, others 10 prod/5 dev (G-077)
- Method-level API GW throttling: /v1/quote 10 rps, /v1/resource 5 rps (G-080)
- AWS X-Ray active tracing on all 4 Lambdas and API GW stage (G-076)
- Rate limiting on POST /dashboard/signup, 5/hour per IP (G-073)
- POST /dashboard/rotate-key documented in openapi.yaml (G-075)
- 6 missing API GW routes wired in CDK + dashboardFn routes table grant (G-074)
- Audit CloudWatch metrics: route.created/deleted, apiKey.rotated, plan.changed (G-071)
- Adapter-level HTTP request timeout, 10s default (G-072)
- Deep health check GET /v1/health/ready: DDB, secrets, chain RPC probes, 503 on failure (G-068)
- Post-deploy smoke test (`scripts/smoke-test.js`): health, signup, x402 challenge (G-070)
- Graceful shutdown: flush CloudWatch metrics and pino logs before Lambda timeout (G-063)
- Configurable ALLOWED_ORIGINS env var replacing Cors.ALL_ORIGINS (G-067)
- CloudWatch Logs 30-day retention on all Lambda log groups (G-066)
- Standard RateLimit-Limit/Remaining/Reset response headers (G-065)
- JSON body size limiting middleware, 100 KB max, 413 Payload Too Large (G-064)
- API versioning header (X-API-Version) and deprecation notice middleware (G-062)
- Tenant route management: PUT/DELETE/GET /dashboard/routes (G-060)
- Webhook delivery DLQ: failed events to DDB with 30d TTL, listPending/retry (G-059)
- GET /v1/payments history with cursor pagination and Zod validation (G-058)
- POST /dashboard/rotate-key: API key rotation endpoint (G-057)
- JSDoc typedefs in `src/types/domain.js` for Route, Tenant, FraudEvent, etc. (G-082)
- Test factory helpers: createTestTenant, createTestPayment, createTestRoute (G-083)
- Rate-limit plan capacity env vars (free/starter/growth/scale) with defaults (G-081)
- TTL constants externalized to env vars: idempotency, fraud, DLQ, secret cache (G-069)
- Fraud threshold limits configurable via environment variables (G-039)

### Changed

- X-API-Version + RateLimit-\* headers + plan tier table in openapi.yaml v0.4.0 (G-087)
- Extracted dashboard HTML template into `src/lib/templates.js` (G-088)
- Split `local-server.js` under 300-line limit (G-086)
- Replaced hardcoded Base RPC URL with Secrets Manager lookup (G-040)
- Expanded vitest `coverage.include` from 3 to 9 src/ directories (G-042)

### Fixed

- Idempotency middleware: cache 4xx with correct status, release lock on 5xx for retry (G-084)
- `routing.service.js`: throw UpstreamError instead of generic Error (G-085)
- Fix tick-start.js coverage metric to parse actual vitest output (G-056)

### Security

- Replaced `__placeholder__` HMAC keys in 5 exchange adapters with Secrets Manager lookups (G-031)
- Exchange API key secret ARNs added to CDK commonEnv, grantRead to webhookFn (G-032)
- Stripe webhook secret + Base RPC URL wired into Secrets Manager (G-028)
- Zod validation for dashboard accountId + CSP header on HTML responses (G-052)
- AWS_REGION and LOG_LEVEL added to CDK commonEnv for all Lambdas (G-053)

### Tests

- 57 tests for all 5 exchange adapters (G-036)
- 154 tests for all 8 Zod validator schemas (G-037)
- 47 tests for adapters/ows/client.js (G-043)
- 24 tests for agent/state.js (G-044)
- 23 tests for lib/logger.js (G-045)
- 22 tests for xrpl-evm/client.js (G-022)
- 22 tests for fraud detection edge cases (G-023)
- 22 tests for tenants.repo + routes.repo CRUD (G-024)
- 22 tests for stripe-webhook.handler + webhook.handler (G-033)
- 21 tests for quote.controller.js (G-034)
- 27 tests for lib/crypto.js + lib/secrets.js (G-035)
- 18 tests for quote.service + routing.service, both 100% coverage (G-019)
- 12 tests for payments.service + payments.repo edge cases (G-020)
- 23 tests for error.middleware + validate.middleware (G-021)
- 13 tests for routes/index.js (G-041)
- 13 integration tests for x402 payment flow with LocalStack DDB (G-049)
- 13 integration tests for dashboard signup → API key → route → payment → history (G-061)
- 10 tests for stripe + payments controller branches (G-054)
- Coverage threshold gate enforcing 80%+ on CI (G-025)
- Per-directory vitest thresholds: services 95%, middleware 95%, lib 50% (G-025)
- Integration test scaffolding with LocalStack DDB (G-038)
- Husky pre-commit hook + lint-staged (G-050)

## [0.4.0] - 2026-04-06

### Added

- CDK stack audit: all DDB tables declared (tenants, routes, usage, rate-limit, idempotency, fraud) (G-026)
- CDK deploy pre-flight: `cdk:diff` script, `docs/DEPLOY.md` with env vars and bootstrap steps (G-027)
- `cdk:deploy:staging` script + CDK context for staging vs prod (G-029)
- Stripe webhook Lambda + API GW route wired in CDK stack (G-030)
- Agent-nonces DDB table + repo for on-chain tx nonce tracking (G-046)
- CloudWatch alarms: Lambda errors, API GW 5xx, DDB throttles + SNS topic (G-047)
- CORS configuration on API Gateway RestApi (G-048)
- Request-level structured logging middleware: method, path, status, latency, correlationId (G-051)

### Tests

- Coverage audit identifying top gaps: quote.service, payments.service, validate.middleware (G-018)

## [0.3.0] - 2026-04-05

### Added

- OpenAPI spec v0.2.0 for all tenant/dashboard routes (G-013)
- esbuild bundling: 4 handlers, ~829 KB total, tree-shaken + minified (G-014)
- CloudWatch EMF metrics: payment.verified, payment.failed, tenant.signup (G-015)
- Idempotency middleware: DDB-backed key locking, 24h TTL, cached replay (G-016)
- 5-minute integration guide for API owners (G-017)

### Tests

- 13 tests for x402.middleware.js, 100% branch coverage (G-006)
- 13 tests for auth.middleware + payments.repo (G-007)
- 13 tests for api.handler.js (G-008)

## [0.2.0] - 2026-04-05

### Added

- Stripe subscription webhook handler for $49/$99/$299 tiers (G-009)
- Per-tenant usage tracking: DDB usage table, atomic increment (G-010)
- Rate limits per tenant via DDB token bucket (G-011)
- Fraud detection: velocity rules, repeated-nonce attempts, abnormal amount distributions (G-012)

## [0.1.0] - 2026-04-05

### Added

- Converted project from TypeScript to pure JavaScript (ESM), Node 20+ (G-000)
- Swapped XRPL EVM adapter to Base mainnet + USDC ERC-20 verification (G-001)
- Tenants DDB table + repo with GSI on apiKeyHash, Zod schemas (G-002)
- Routes DDB table with tenantId+path composite key, repo CRUD (G-003)
- Per-route DDB price lookup replacing static amountWei (G-004)
- Minimal dashboard Lambda: tenant signup, API key display, recent payments table (G-005)
