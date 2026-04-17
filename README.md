# BitBooth

**The payment gateway for the agentic web.**

BitBooth lets AI agents and machines pay for API access per-request, settling in USDC on **Base** (EVM). Developers register their APIs, set per-endpoint pricing in wei, and BitBooth handles the full x402 flow — challenge, payment verification, on-chain settlement, fraud detection, and rate limiting. Fiat onramping is routed to the best quote across Moonpay, Coinbase, Kraken, Binance/US, and Uphold.

> Built on the [x402 protocol](https://github.com/coinbase/x402) (HTTP 402 Payment Required).

## How it works

```
Agent                         BitBooth                        Your API
  │                              │                               │
  │── POST /v1/resource ────────►│                               │
  │◄── 402 Payment Required ─────│  (challenge: amount, nonce)   │
  │                              │                               │
  │── X-PAYMENT: <signed> ──────►│                               │
  │                              │── verify sig + on-chain ──►   │
  │                              │◄── confirmed ─────────────    │
  │                              │── proxy request ──────────►   │
  │◄── 200 OK ──────────────────────────────────────────────────│
```

1. Agent calls a paywalled endpoint
2. Gets `402 Payment Required` with a challenge (amount, nonce, payTo address, expiry)
3. Agent signs the payment with its wallet
4. Sends the signed payment in the `X-PAYMENT` header
5. BitBooth verifies the signature, checks replay, confirms on-chain, proxies through

## Live demo

**[app.heinrichstech.com](https://app.heinrichstech.com)** — try the landing page, grab a demo API key, and hit the Swagger docs.

## API

| Method | Path                   | Description                                  |
| ------ | ---------------------- | -------------------------------------------- |
| `GET`  | `/v1/health`           | Health check                                 |
| `POST` | `/v1/quote`            | Best fiat-to-crypto quote across 5 exchanges |
| `POST` | `/v1/resource`         | Access an x402-paywalled resource            |
| `POST` | `/v1/resource/premium` | Premium paywalled resource (2x price)        |
| `GET`  | `/v1/payments`         | Payment history (cursor pagination)          |
| `GET`  | `/`                    | Landing page                                 |
| `GET`  | `/docs`                | Swagger UI                                   |
| `POST` | `/demo/signup`         | Claim a free demo API key                    |
| `GET`  | `/portal`              | Client portal sign-in                        |
| `GET`  | `/portal/dashboard`    | Tenant dashboard (plan, usage, payments)     |
| `GET`  | `/admin/tenants`       | Admin tenant management                      |

Full spec in [`openapi.yaml`](openapi.yaml).

## Architecture

```
BitBooth/
├── src/
│   ├── routes/          # HTTP route tables
│   ├── controllers/     # Request parsing, response shaping
│   ├── services/        # Business logic, orchestration
│   ├── adapters/        # External system clients
│   │   ├── xrpl-evm/   #   Base chain (ethers.js)
│   │   ├── moonpay/    #   Exchange adapters
│   │   ├── coinbase/
│   │   ├── kraken/
│   │   ├── binance/
│   │   ├── uphold/
│   │   └── ows/        #   Open Wallet Standard
│   ├── middleware/      # x402, auth, rate-limit, idempotency, CORS, errors
│   ├── validators/      # Zod schemas (every boundary validated)
│   ├── repositories/    # DynamoDB (10 tables)
│   ├── handlers/        # Lambda entry points
│   ├── lib/             # Config, logger, errors, crypto, metrics, secrets
│   ├── static/          # Theme, landing page, portal UI
│   └── types/           # JSDoc typedefs
├── infra/               # AWS CDK (Lambda + API GW + DDB + Secrets Manager + WAF)
├── tests/               # 2,200+ tests, 99.91% coverage
├── scripts/             # Smoke tests, load tests, deploy tools
├── docs/                # Deploy guide, integration guide
└── .claude/             # Skills + agent config
```

## Stack

- **Runtime:** Node 20, pure JavaScript (ESM), no TypeScript
- **Cloud:** AWS Lambda, API Gateway, DynamoDB, Secrets Manager, CloudWatch
- **Chain:** Base (EVM), USDC settlement
- **Protocol:** x402 (HTTP 402 Payment Required)
- **Validation:** Zod at every boundary
- **Testing:** Vitest — 2,200+ tests, 99.91% coverage
- **Infra:** AWS CDK (stage-aware: dev/staging/prod)
- **Bundle:** 177 KB (esbuild)

## What's built

- x402 challenge/response payment flow with signature verification and replay protection
- Multi-exchange fiat onramping with best-quote routing (Moonpay, Coinbase, Kraken, Binance, Uphold)
- Multi-tenant self-service: signup, API keys, route management, per-route pricing
- Client portal with session-based auth (plan/usage dashboard, payment history, API key management)
- Admin dashboard (tenant management, suspend/reactivate, metrics)
- Fraud detection (velocity rules, nonce tracking, amount bounds, configurable thresholds)
- Per-tenant rate limiting (token bucket, 4 tiers: Free/Starter/Growth/Scale)
- Idempotency (24h result caching with DynamoDB TTL)
- Webhook processing with dead letter queue and retry
- Premium route pricing (per-endpoint price multipliers)
- Obol design system (dark theme, WCAG AA compliant)
- Swagger UI + OpenAPI 3.0 spec
- CloudWatch Synthetics canary, alarms, structured logging
- Stripe billing integration (subscription tiers)
- API versioning with deprecation headers (RFC 8594)
- CSP security headers, input validation, secret redaction

## Quick start

```bash
npm install
npm run lint
npm test
npm run build
npm run cdk:synth
```

## Deploy

```bash
# Staging
STAGE=staging npm run cdk:deploy:staging

# Production
STAGE=prod npm run cdk:deploy:prod
```

## Docs

- [`CLAUDE.md`](CLAUDE.md) — development conventions and non-negotiables
- [`openapi.yaml`](openapi.yaml) — full API specification
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — CDK deployment guide
- [`docs/integration-guide.md`](docs/integration-guide.md) — 5-minute API integration walkthrough
- [`GOALS.md`](GOALS.md) — roadmap and goal tracker

## License

Proprietary. All rights reserved.
