# Deploying x402

This guide covers everything needed to deploy x402 from a clean AWS account to a running stack.

## Prerequisites

- **Node.js 20+** with npm
- **AWS CLI v2** configured with credentials (`aws sts get-caller-identity` should succeed)
- **AWS CDK CLI** (installed as a devDependency; use `npx cdk` or `npm run cdk:*` scripts)

### Hard prereqs for `STAGE=prod` (mainnet cutover)

The prod stage flips the chain from Base Sepolia to **Base mainnet** (chainId
`8453`) and moves real USDC. Before the first prod deploy these must be true:

1. **Lambda concurrent-executions quota ≥ 100** in the target region.
   The AWS new-account default is `10`, which will throttle under any
   real traffic. File the increase **before** the first prod deploy:
   ```bash
   aws service-quotas request-service-quota-increase \
     --service-code lambda \
     --quota-code L-B99A9384 \
     --desired-value 1000 \
     --region us-east-2
   ```
   Track the request:
   ```bash
   aws service-quotas list-requested-service-quota-change-history \
     --service-code lambda --region us-east-2
   ```
   Current open request: id `9c88f92c5432473ab433ccb96a54c4adOlw1JYRT`,
   desired `1000`, filed `2026-04-11`. Block the prod cutover until status
   flips to `APPROVED`.
2. **All `x402/prod/*` Secrets Manager entries populated** (agent-wallet,
   base-rpc, stripe, moonpay, coinbase). The staging copies are NOT reused.
3. **Agent wallet funded on Base mainnet** with at least 5 USDC + 0.02 ETH
   for gas (the staging wallet on Sepolia is not the same key; mint a fresh
   key via `scripts/ops/flush-wallet.js` output).
4. `npm test` + `npm run lint` green, `npm run cdk:diff` reviewed, and
   `npm run cdk:deploy:prod` run from a human terminal (NOT the autopilot
   container) with 2FA active on the IAM user.

## Required Environment Variables

### CDK / Infrastructure

| Variable              | Description                                 | Example        |
| --------------------- | ------------------------------------------- | -------------- |
| `CDK_DEFAULT_ACCOUNT` | AWS account ID                              | `816711409613` |
| `CDK_DEFAULT_REGION`  | AWS region for deployment                   | `us-east-2`    |
| `STAGE`               | Deployment stage (`dev`, `staging`, `prod`) | `dev`          |

> Note: production x402 runs in **us-east-2**. Earlier drafts of this doc used
> `us-east-1` as a placeholder — do not deploy there by accident.

### Lambda Runtime

These are set automatically by the CDK stack via `commonEnv`. You do **not** need to set them manually unless running locally.

| Variable                      | Description                           | Default                                      |
| ----------------------------- | ------------------------------------- | -------------------------------------------- |
| `CHAIN_ID`                    | EVM chain ID                          | `8453`                                       |
| `USDC_CONTRACT_ADDRESS`       | Base USDC ERC-20 contract             | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `X402_PAYMENT_WINDOW_SECONDS` | Max age of payment signature          | `120`                                        |
| `X402_REQUIRED_CONFIRMATIONS` | Block confirmations for micropayments | `2`                                          |

## AWS Secrets Manager Entries

Create these secrets **before** the first deploy. The CDK stack references them by ARN.

| Secret Name                       | Contents                                                                 | Required                |
| --------------------------------- | ------------------------------------------------------------------------ | ----------------------- |
| `x402/<stage>/agent-wallet`       | JSON: `{ "privateKey": "0x..." }` — the agent's Base wallet key          | Yes                     |
| `x402/<stage>/base-rpc`           | Plain string: Base mainnet RPC URL (may contain API key)                 | Yes                     |
| `x402/<stage>/exchanges/stripe`   | JSON: `{ "webhookSecret": "whsec_..." }` — Stripe webhook signing secret | If using Stripe billing |
| `x402/<stage>/exchanges/moonpay`  | JSON: `{ "apiKey": "...", "webhookSecret": "..." }`                      | If using Moonpay        |
| `x402/<stage>/exchanges/coinbase` | JSON: `{ "apiKey": "...", "webhookSecret": "..." }`                      | If using Coinbase       |

Create a secret via CLI:

```bash
aws secretsmanager create-secret \
  --name "x402/dev/agent-wallet" \
  --secret-string '{"privateKey":"0xYOUR_PRIVATE_KEY_HERE"}' \
  --region us-east-2
```

## Bootstrap (First-Time Setup)

CDK requires a one-time bootstrap per account/region pair. This creates the staging S3 bucket and IAM roles CDK needs.

```bash
npx cdk bootstrap aws://ACCOUNT_ID/REGION --app 'node infra/app.js'
```

Example:

```bash
npx cdk bootstrap aws://123456789012/us-east-1 --app 'node infra/app.js'
```

## Build & Deploy Workflow

### 1. Install dependencies

```bash
npm ci
```

### 2. Run lint + tests

```bash
npm run lint
npm test
```

### 3. Bundle Lambda handlers

```bash
npm run build
```

This runs esbuild and produces minified bundles in `dist/`.

### 4. Synthesize CloudFormation template

```bash
npm run cdk:synth
```

Review the generated `cdk.out/` template to confirm resources match expectations.

### 5. Preview changes (diff)

```bash
npm run cdk:diff
```

This compares your local template against the currently deployed stack. Use this before every deploy to catch unexpected changes.

### 6. Deploy

**Dev** (auto-approves all changes):

```bash
STAGE=dev npm run cdk:deploy
```

**Staging** (requires approval for IAM/security changes):

```bash
npm run cdk:deploy:staging
```

**Prod** (manual approval recommended):

```bash
STAGE=prod cdk deploy --app 'node infra/app.js' --require-approval broadening
```

## DynamoDB Tables Created

The stack creates the following tables (all PAY_PER_REQUEST, with point-in-time recovery):

| Table                       | Partition Key    | Sort Key    | Notes                            |
| --------------------------- | ---------------- | ----------- | -------------------------------- |
| `x402-payments-<stage>`     | `idempotencyKey` | —           | GSI on `accountId` + `createdAt` |
| `x402-tenants-<stage>`      | `accountId`      | —           | GSI on `apiKeyHash`              |
| `x402-routes-<stage>`       | `tenantId`       | `path`      |                                  |
| `x402-usage-<stage>`        | `accountId`      | `yearMonth` |                                  |
| `x402-rate-limits-<stage>`  | `accountId`      | —           |                                  |
| `x402-idempotency-<stage>`  | `idempotencyKey` | —           | TTL on `ttl`                     |
| `x402-fraud-events-<stage>` | `accountId`      | `timestamp` | TTL on `ttl`                     |
| `x402-fraud-tally-<stage>`  | `accountId`      | `windowKey` | TTL on `ttl`                     |

## Lambda Functions

| Function                 | Handler                              | Purpose                                               |
| ------------------------ | ------------------------------------ | ----------------------------------------------------- |
| `x402-api-<stage>`       | `handlers/api.handler.handler`       | Main API: health, quote, resource (x402 payment flow) |
| `x402-webhook-<stage>`   | `handlers/webhook.handler.handler`   | Exchange/Stripe webhook ingestion                     |
| `x402-dashboard-<stage>` | `handlers/dashboard.handler.handler` | Tenant signup + dashboard UI                          |

## API Gateway Routes

| Method | Path                      | Auth                            | Handler   |
| ------ | ------------------------- | ------------------------------- | --------- |
| GET    | `/v1/health`              | None                            | API       |
| POST   | `/v1/quote`               | API Key                         | API       |
| POST   | `/v1/resource`            | API Key                         | API       |
| POST   | `/v1/webhooks/{provider}` | None (HMAC verified in handler) | Webhook   |
| GET    | `/dashboard`              | None                            | Dashboard |
| POST   | `/dashboard/signup`       | None                            | Dashboard |

## Teardown

To destroy a non-prod stack:

```bash
STAGE=dev cdk destroy --app 'node infra/app.js'
```

Prod tables have `RemovalPolicy.RETAIN` and will **not** be deleted on stack teardown.

## Troubleshooting

- **`cdk:diff` shows no stacks**: Ensure `STAGE` is set and matches a deployed stack, or run `cdk:synth` first to verify the template generates.
- **Secret not found at deploy time**: Create the Secrets Manager entries listed above before deploying. The CDK stack references them by convention name.
- **Bootstrap errors**: Ensure your AWS credentials have `cloudformation:*`, `s3:*`, `iam:*` permissions for the bootstrap process.
