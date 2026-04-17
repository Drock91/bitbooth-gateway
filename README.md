# BitBooth

**The payment gateway for the agentic web.** AI agents pay for APIs per-request in stablecoin — no API keys, no signup, no humans in the loop.

Built on the [x402 protocol](https://x402.gitbook.io) (HTTP 402 Payment Required) from the x402 Foundation (Coinbase + Linux Foundation).

[![MIT license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-3,317_passing-brightgreen.svg)](#testing)
[![Node 20](https://img.shields.io/badge/node-20-blue.svg)](https://nodejs.org)

---

## Try it right now

The flagship agent-native endpoint. **No API key. No signup. Just pay.**

```bash
# 1. Hit the endpoint — get a 402 with a payment challenge
curl -X POST https://x76se73jxd.execute-api.us-east-2.amazonaws.com/staging/v1/fetch \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","mode":"fast"}'

# HTTP/1.1 402 Payment Required
# {
#   "challenge": {
#     "nonce": "e058d5d6272f4dd8192abf8f4ba1bcb0",
#     "accepts": [{
#       "network": "eip155:84532",
#       "payTo": "0x6Eb83C70a71c81BE7Fc13F0d711A28736a9E37Fc",
#       "asset": "USDC@0x036CbD53842c5426634e7929541eC2318f3dCF7e",
#       "amount": "5000"
#     }]
#   }
# }

# 2. Agent signs + sends 0.005 USDC on Base Sepolia to payTo
# 3. Agent retries with X-Payment header containing the tx hash
# 4. Gets 200 OK + clean markdown back
```

**Or try it live** — click "Run Demo" on the 6-chain race:
<br>→ **[heinrichstech.com/bitbooth.html](https://heinrichstech.com/bitbooth.html)**

## Install as an MCP server

One line and any Claude Code / Cursor / Windsurf / Continue agent can use it:

```bash
npm install @bitbooth/mcp-fetch
```

Add to your MCP config:

```json
{
  "mcpServers": {
    "bitbooth-fetch": {
      "command": "npx",
      "args": ["-y", "@bitbooth/mcp-fetch"],
      "env": { "BITBOOTH_AGENT_KEY": "0x<your-testnet-wallet-private-key>" }
    }
  }
}
```

See [`packages/mcp-fetch/README.md`](packages/mcp-fetch/README.md) for full configuration.

## How it works

```
Agent                         BitBooth                        Your API
  │                              │                               │
  │── POST /v1/fetch ───────────►│                               │
  │◄── 402 Payment Required ─────│  (challenge: amount, nonce)   │
  │                              │                               │
  │── send USDC on-chain ────────────────────────────────────►   │
  │── retry with X-Payment ─────►│                               │
  │                              │── verify on-chain ────────►   │
  │                              │◄── confirmed ─────────────    │
  │                              │── proxy request ──────────►   │
  │◄── 200 OK ──────────────────────────────────────────────────│
```

1. Agent calls a paywalled endpoint
2. Server returns `402 Payment Required` with a signed challenge (amount, nonce, payTo, expiry)
3. Agent signs and sends the payment from its wallet
4. Agent retries with the tx hash in the `X-Payment` header
5. BitBooth verifies on-chain, checks replay protection, proxies through
6. Server responds `200 OK`

One round-trip. Sub-10s on EVM/XRPL/Solana/Stellar. Sub-second on Lightning (Q2 2026 roadmap).

## Supported chains

| Network | CAIP-2 | Asset | Status |
|---|---|---|---|
| Base Sepolia | `eip155:84532` | USDC | ✅ Live (default) |
| Base Mainnet | `eip155:8453` | USDC | ✅ Live (opt-in) |
| XRPL EVM Sidechain | `eip155:1440002` | USDC | ✅ Live |
| XRPL Mainnet | `xrpl:0` | USDC, RLUSD, XRP | ✅ Live |
| XRPL Testnet | `xrpl:1` | XRP | ✅ Live |
| Solana Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | USDC-SPL | ✅ Live |
| Solana Devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | USDC-SPL | ✅ Live |
| Stellar Testnet | — | XLM | ✅ Live |
| Bitcoin Lightning (L402) | — | sats | 🛣 Roadmap Q2 2026 |

Every 402 challenge returns an `accepts[]` array of all enabled chains. The agent picks the rail it already has balance for.

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/fetch` | **x402 only** | URL → clean markdown. No API key. Pay-per-call. |
| `POST` | `/v1/resource` | API key + x402 | Paywalled resource (tenant-configured pricing) |
| `POST` | `/v1/resource/premium` | API key + x402 | Premium resource (2× price) |
| `POST` | `/v1/resource/bulk` | API key + x402 | Bulk operations (amount × item count) |
| `POST` | `/v1/quote` | API key | Best fiat-to-crypto quote across 5 exchanges |
| `GET`  | `/v1/payments` | API key | Payment history (cursor pagination) |
| `GET`  | `/v1/health` | — | Health check |
| `GET`  | `/v1/health/ready` | — | Readiness (DDB + RPC + secrets) |

Full spec in [`openapi.yaml`](openapi.yaml).

## Architecture

```
bitbooth-gateway/
├── src/
│   ├── routes/          # HTTP route tables
│   ├── controllers/     # Request parsing, response shaping
│   ├── services/        # Business logic, orchestration
│   ├── adapters/        # External system clients
│   │   ├── base/        #   Base mainnet + Sepolia (viem)
│   │   ├── xrpl/        #   Native XRPL (xrpl.js)
│   │   ├── xrpl-evm/    #   XRPL EVM Sidechain (ethers)
│   │   ├── solana/      #   Solana mainnet + devnet (@solana/web3.js)
│   │   ├── moonpay/     #   Fiat onramp adapters
│   │   ├── coinbase/
│   │   ├── kraken/
│   │   ├── binance/
│   │   ├── uphold/
│   │   └── ows/         #   Open Wallet Standard
│   ├── middleware/      # x402, auth, rate-limit, idempotency, errors, CORS
│   ├── validators/      # Zod schemas (every boundary validated)
│   ├── repositories/    # DynamoDB (10 tables)
│   ├── handlers/        # Lambda entry points
│   └── lib/             # Config, logger, errors, crypto, metrics, secrets
├── infra/               # AWS CDK (Lambda + API GW + DDB + Secrets Manager + WAF)
├── packages/
│   ├── mcp-fetch/       # @bitbooth/mcp-fetch — MCP server for fetch tool
│   ├── langchain-bitbooth/  # LangChain tool wrapper
│   └── bitbooth-py/     # Python client
├── tests/               # 3,317 unit tests + integration tests
├── scripts/             # Smoke tests, load tests, ops tools
└── docs/                # Deploy guide, integration guide, ADRs
```

## Stack

- **Runtime:** Node 20, pure JavaScript (ESM), no TypeScript
- **Cloud:** AWS Lambda, API Gateway, DynamoDB, Secrets Manager, CloudWatch, WAF
- **Chains:** XRPL, XRPL EVM, Solana, Base, Stellar
- **Protocol:** x402 V2 (HTTP 402 Payment Required)
- **Validation:** Zod at every boundary
- **Testing:** Vitest — 3,317 tests, 99%+ coverage
- **Infra:** AWS CDK (stage-aware: dev/staging/prod)
- **Deploy:** esbuild bundles per-Lambda, `cdk deploy`

## What's built

- **x402 V2 protocol** — challenge/response with signature verification, nonce-based replay protection, on-chain settlement
- **Multi-chain routing** — single API, multiple rails. Agent picks based on wallet balance
- **Agent-native endpoint** (`/v1/fetch`) — zero signup, zero API key, pure pay-per-call
- **Multi-tenant SaaS** — self-service signup, API keys, per-route pricing
- **Fiat onramping** — best-quote routing across Moonpay, Coinbase, Kraken, Binance, Uphold
- **Fraud prevention** — velocity rules, nonce tracking, amount bounds, configurable thresholds
- **Rate limiting** — token bucket, 4 tiers (Free/Starter/Growth/Scale), plus per-IP for anonymous callers
- **Idempotency** — 24h result caching via DynamoDB TTL
- **Webhook DLQ** — retry with exponential backoff, max-age cleanup
- **Client portal** — session-based auth, plan/usage dashboard, payment history
- **Admin dashboard** — tenant management, suspend/reactivate, metrics
- **Observability** — CloudWatch Synthetics canary, alarms, structured pino logging with redaction
- **Swagger UI + OpenAPI 3.0**

## Quick start

```bash
npm install           # install deps
npm run lint          # eslint --max-warnings=0
npm test              # 3,317 tests, ~20s
npm run build         # esbuild bundles to dist/
npm run cdk:synth     # validates CDK stack (STAGE=dev)
```

## Deploy

```bash
# Staging (Base Sepolia, free testnet USDC)
STAGE=staging npm run cdk:deploy:staging

# Production (Base mainnet, real USDC)
STAGE=prod npm run cdk:deploy:prod
```

Full walkthrough in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Testing

```bash
npm test                          # run all 3,317 unit tests
npm run test:integration          # requires LocalStack + testnet RPC
npm run test:coverage             # coverage report (must be ≥80% on services/ and middleware/)
```

## Docs

- [`CLAUDE.md`](CLAUDE.md) — development conventions and non-negotiables (read before contributing)
- [`openapi.yaml`](openapi.yaml) — full API specification
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — CDK deployment guide
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — operational runbook (alerts, incident response)
- [`docs/integration-guide.md`](docs/integration-guide.md) — 5-minute API integration walkthrough
- [`docs/adr/`](docs/adr/) — architecture decision records
- [`packages/mcp-fetch/README.md`](packages/mcp-fetch/README.md) — MCP server for AI agents

## Security

- No secrets in code — all loaded from AWS Secrets Manager at cold start
- Least-privilege IAM per Lambda
- x402 endpoints verify signature, check nonce, enforce replay window ≤ 120s
- Webhooks verify HMAC before any business logic
- Logger redacts API keys, private keys, signed payloads
- Input size limits: JSON body ≤ 100KB unless explicitly opted in
- Rate limits via API Gateway usage plans + per-account token bucket

See [`CLAUDE.md`](CLAUDE.md#security) for the full security posture.

## Contributing

This is a working open-source x402 reference gateway. PRs welcome. Before opening one:

1. `npm run lint` must pass with zero warnings
2. `npm test` must pass all 3,317 tests
3. `npm audit --audit-level=high` must return 0
4. Add Zod validators for any new request shape
5. No TypeScript — this is pure JavaScript + JSDoc typedefs (see [`CLAUDE.md`](CLAUDE.md#coding-style))

## License

[MIT](LICENSE) — free for commercial and personal use.

---

**Links**

- [Live demo (6-chain race)](https://heinrichstech.com/bitbooth.html)
- [Live staging API](https://x76se73jxd.execute-api.us-east-2.amazonaws.com/staging/v1/fetch)
- [@bitbooth/mcp-fetch on npm](https://www.npmjs.com/package/@bitbooth/mcp-fetch)
- [x402 V2 spec (Coinbase + Linux Foundation)](https://x402.gitbook.io)
- [.well-known/agent.json](https://heinrichstech.com/.well-known/agent.json)
- [llms.txt](https://heinrichstech.com/llms.txt)
