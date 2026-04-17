# x402 Operations Runbook

> Day-to-day operational procedures for the x402 payment gateway.
> All table/resource names use the pattern `x402-<resource>-<stage>` (e.g. `x402-payments-prod`).

## Table of Contents

1. [Alarm Response](#alarm-response)
2. [Webhook DLQ Triage](#webhook-dlq-triage)
3. [SQS DLQ Triage](#sqs-dlq-triage)
4. [Secret Rotation](#secret-rotation)
5. [Tenant Suspension](#tenant-suspension)
6. [Rate Limit Override](#rate-limit-override)
7. [Health Check Failures](#health-check-failures)
8. [Disaster Recovery (DR/RTO/RPO)](#disaster-recovery-drtorpo)
9. [Useful Commands](#useful-commands)

---

## Alarm Response

All alarms publish to SNS topic `x402-alarms-<stage>`. Subscribe via email or PagerDuty.

### Lambda Error Alarms

**Trigger:** >= 5 errors in 5 minutes on any Lambda.

**Alarms:** `x402-<stage>-api-errors`, `x402-<stage>-webhook-errors`, `x402-<stage>-stripwebhook-errors`, `x402-<stage>-dashboard-errors`, `x402-<stage>-dlqsweep-errors`

**Response:**

1. Open CloudWatch Logs for the affected function (`/aws/lambda/x402-<function>-<stage>`).
2. Filter by `correlationId` from the error log line.
3. Check for upstream failures (exchange API, Base RPC, DynamoDB).
4. If the error is a cold-start timeout, check reserved concurrency (api=100, others=10 in prod).
5. If errors are from a bad deployment, roll back: `npx cdk deploy --context stage=<stage>` with the previous artifact.

### API Gateway 5xx Alarm

**Trigger:** >= 10 server errors in 5 minutes.

**Alarm:** `x402-<stage>-apigw-5xx`

**Response:**

1. Check Lambda error alarms first — most 5xx originate from Lambda failures.
2. If Lambdas are healthy, check API GW execution logs for integration timeouts.
3. Verify the deployment stage is pointing to correct Lambda aliases.

### API Gateway 4xx Alarm

**Trigger:** >= 50 client errors in 5 minutes.

**Alarm:** `x402-<stage>-apigw-4xx`

**Response:**

1. A burst of 4xx is often normal (bad API keys, invalid requests).
2. If correlated with a single IP, check rate-limit table for that tenant or IP prefix.
3. If correlated with a single route, verify route config in the `routes` table.
4. Investigate potential credential stuffing if `401` responses dominate.

### DynamoDB Throttle Alarms

**Trigger:** Any throttle event on any of the 10 tables.

**Alarms:** `x402-<stage>-ddb-<tablename>-throttles`

**Tables monitored:** payments, tenants, routes, usage, ratelimit, idempotency, fraudevents, fraudtally, agentnonces, webhookdlq

**Response:**

1. All tables use PAY_PER_REQUEST billing — throttles indicate a partition hot-key.
2. Check CloudWatch `ConsumedReadCapacityUnits` / `ConsumedWriteCapacityUnits` per partition.
3. For `ratelimit` table: a single tenant with very high traffic can hot-key. Consider moving them to a dedicated partition.
4. For `payments` table: batch inserts from a webhook replay can cause spikes. Throttle the replay.

### Lambda Duration P99 Alarms

**Trigger:** P99 latency exceeds threshold in 5 minutes.

**Alarms:** `x402-<stage>-<function>-duration-p99`

| Function      | Threshold         |
| ------------- | ----------------- |
| Api           | 8000 ms           |
| Webhook       | 8000 ms           |
| StripeWebhook | 8000 ms           |
| Dashboard     | 8000 ms           |
| DlqSweep      | 240000 ms (4 min) |

**Response:**

1. Check if the spike is cold-start related (look for `Init Duration` in logs).
2. Check downstream latency: Base RPC, exchange APIs, DynamoDB.
3. If sustained, increase Lambda memory (higher memory = faster CPU).
4. For DlqSweep, check if the batch size is too large (`DLQ_SWEEP_BATCH_SIZE`).

### SQS DLQ Alarms

**Trigger:** >= 1 message in SQS DLQ.

**Alarms:** `x402-<stage>-sqs-webhookdlq-messages`, `x402-<stage>-sqs-stripwebhookdlq-messages`

**Response:**

1. Messages in SQS DLQ indicate Lambda invocations that failed after all retries.
2. Inspect messages: `aws sqs receive-message --queue-url <dlq-url> --max-number-of-messages 10`.
3. Check the corresponding Lambda logs for the error.
4. Once root cause is fixed, redrive messages from the SQS console or CLI.

---

## Webhook DLQ Triage

Failed webhook deliveries are recorded in the `x402-webhook-dlq-<stage>` DynamoDB table.

### How It Works

1. When a webhook handler (`/v1/webhooks/:provider`) fails to process an event, it records the event in the DLQ table with status `pending`.
2. The `dlq-sweep` Lambda runs every 5 minutes via EventBridge.
3. It queries pending events, applies exponential backoff, and retries.
4. Backoff schedule: 5min, 10min, 20min, 40min, 80min (capped at 4 hours).
5. After 5 retries, the event is marked `resolved` (exhausted).

### Querying Pending Events

```bash
# List pending events
aws dynamodb query \
  --table-name x402-webhook-dlq-prod \
  --index-name gsi-status \
  --key-condition-expression "#s = :status" \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values '{":status":{"S":"pending"}}'
```

### Querying by Provider

```bash
aws dynamodb query \
  --table-name x402-webhook-dlq-prod \
  --index-name gsi-provider \
  --key-condition-expression "provider = :p" \
  --expression-attribute-values '{":p":{"S":"moonpay"}}'
```

### Manual Retry

If the root cause is fixed and you want to force immediate retry:

```bash
# Reset retryCount to trigger re-processing on next sweep
aws dynamodb update-item \
  --table-name x402-webhook-dlq-prod \
  --key '{"eventId":{"S":"<event-id>"}}' \
  --update-expression "SET #s = :pending, retryCount = :zero, updatedAt = :now" \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values '{":pending":{"S":"pending"},":zero":{"N":"0"},":now":{"S":"'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"}}'
```

### Escalation

If a provider's webhooks are consistently failing:

1. Check the provider's status page (e.g. status.moonpay.com).
2. Verify the webhook secret hasn't rotated on the provider side.
3. Check if the provider changed their payload format (Zod validation errors in logs).

---

## SQS DLQ Triage

SQS dead-letter queues capture Lambda invocations that failed all retry attempts.

**Queues:**

- `x402-webhook-dlq-<stage>` (SQS) — failed `webhookFn` invocations
- `x402-stripe-webhook-dlq-<stage>` (SQS) — failed `stripeWebhookFn` invocations

Both have 14-day message retention.

### Inspect Messages

```bash
aws sqs receive-message \
  --queue-url https://sqs.<region>.amazonaws.com/<account>/x402-webhook-dlq-<stage> \
  --max-number-of-messages 10 \
  --visibility-timeout 0
```

### Redrive

After fixing the root cause, use the AWS Console **DLQ redrive** feature or manually send messages back to the source queue.

---

## Secret Rotation

Secrets are stored in AWS Secrets Manager and cached in-memory for 5 minutes (configurable via `SECRET_CACHE_TTL_MS`).

### Secrets Inventory

| Secret Path                       | Contents                                 | Rotation Impact                                    |
| --------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| `x402/<stage>/agent-wallet`       | `{"privateKey":"0x..."}`                 | Settlement stops until new key funds are available |
| `x402/<stage>/stripe-webhook`     | `{"webhookSecret":"whsec_..."}`          | Stripe webhooks fail signature verification        |
| `x402/<stage>/base-rpc`           | RPC URL string                           | Chain interactions fail                            |
| `x402/<stage>/admin-api-key-hash` | SHA-256 hash string                      | Admin endpoints return 401                         |
| `x402/<stage>/exchanges/<name>`   | `{"apiKey":"...","webhookSecret":"..."}` | Exchange quotes/webhooks fail                      |

### Rotation Procedure

1. **Update the secret in Secrets Manager:**

   ```bash
   aws secretsmanager update-secret \
     --secret-id x402/prod/stripe-webhook \
     --secret-string '{"webhookSecret":"whsec_new_value"}'
   ```

2. **Wait for cache expiry.** Default TTL is 5 minutes. All Lambdas will pick up the new value within this window. To force immediate pickup, redeploy or update the Lambda environment variable (triggers a cold start):

   ```bash
   aws lambda update-function-configuration \
     --function-name x402-api-prod \
     --environment "Variables={FORCE_RESTART=$(date +%s)}"
   ```

3. **Verify.** Hit `GET /v1/health/ready` — the secrets check will confirm Secrets Manager access is working.

### Agent Wallet Rotation

This is the most critical secret. Rotating it means the settlement address changes.

**Automated (recommended):** Use the flush-wallet script which handles the full lifecycle:

```bash
# Preview what will happen (no changes made)
node scripts/ops/flush-wallet.js --stage=prod

# Execute: drain balances → archive old key → update secret → init nonce
node scripts/ops/flush-wallet.js --stage=prod --execute
```

The script performs these steps atomically:

1. Loads old wallet key from Secrets Manager
2. Generates new wallet (random 32-byte key)
3. Queries USDC + native balances of old wallet
4. Transfers USDC to new wallet (if balance > 0)
5. Transfers remaining native gas to new wallet (minus gas cost)
6. Archives old key to `x402/<stage>/agent-wallet-archive-<timestamp>`
7. Updates `x402/<stage>/agent-wallet` with new key
8. Initializes nonce tracking in DDB for new address

Safety: if archive fails, the script aborts before updating the wallet secret. A structured JSON audit log is printed on every run.

After running, wait 5 minutes for secret cache expiry, then monitor `chain.tx.submitted` metrics.

**Manual fallback** (if script cannot be used):

1. Fund the new wallet address with ETH (for gas) and optionally USDC.
2. Update the secret: `aws secretsmanager update-secret --secret-id x402/prod/agent-wallet --secret-string '{"privateKey":"0xNEW"}'`
3. Wait 5 minutes for cache expiry.
4. Monitor `chain.tx.submitted` metrics to confirm new transactions succeed.
5. Drain remaining funds from the old wallet.

### Exchange API Key Rotation

1. Generate a new API key on the exchange dashboard.
2. Update the secret: `aws secretsmanager update-secret --secret-id x402/prod/exchanges/moonpay --secret-string '{"apiKey":"new_key","webhookSecret":"new_hmac"}'`
3. Update the webhook URL on the exchange dashboard if the signature secret changed.
4. Wait 5 minutes, then test with a small quote request.

---

## Tenant Suspension

There is no `suspended` status field in the tenant schema. To suspend a tenant, rotate their API key to a value they don't know.

### Suspend a Tenant

```bash
# Generate a random hash (tenant won't know the corresponding key)
RANDOM_HASH=$(openssl rand -hex 32)

aws dynamodb update-item \
  --table-name x402-tenants-prod \
  --key '{"accountId":{"S":"<tenant-uuid>"}}' \
  --update-expression "SET apiKeyHash = :h" \
  --expression-attribute-values '{":h":{"S":"'$RANDOM_HASH'"}}'
```

The tenant's existing API key will immediately stop authenticating. All requests will return 401.

### Reinstate a Tenant

Provide the tenant with a new API key via the dashboard signup flow, or manually set a known hash:

```bash
# Generate a new key and its hash
NEW_KEY=$(openssl rand -hex 32)
NEW_HASH=$(echo -n "$NEW_KEY" | sha256sum | cut -d' ' -f1)

aws dynamodb update-item \
  --table-name x402-tenants-prod \
  --key '{"accountId":{"S":"<tenant-uuid>"}}' \
  --update-expression "SET apiKeyHash = :h" \
  --expression-attribute-values '{":h":{"S":"'$NEW_HASH'"}}'

echo "New API key: $NEW_KEY"
```

Communicate the new key to the tenant securely.

### Downgrade a Tenant's Plan

To restrict a tenant's access without full suspension:

```bash
aws dynamodb update-item \
  --table-name x402-tenants-prod \
  --key '{"accountId":{"S":"<tenant-uuid>"}}' \
  --update-expression "SET #p = :plan" \
  --expression-attribute-names '{"#p":"plan"}' \
  --expression-attribute-values '{":plan":{"S":"free"}}'
```

This immediately lowers their rate limits to the `free` tier (10 req/min).

---

## Rate Limit Override

Rate limit buckets are stored in `x402-rate-limits-<stage>`.

### Plan Tiers

| Plan    | Capacity (tokens/min) | Refill Rate (tokens/sec) |
| ------- | --------------------- | ------------------------ |
| free    | 10                    | 0.167                    |
| starter | 100                   | 1.667                    |
| growth  | 500                   | 8.333                    |
| scale   | 2000                  | 33.333                   |

Configurable via env vars: `RATE_LIMIT_FREE`, `RATE_LIMIT_STARTER`, `RATE_LIMIT_GROWTH`, `RATE_LIMIT_SCALE`.

### Reset a Tenant's Rate Limit Bucket

If a tenant is incorrectly rate-limited, delete their bucket entry to reset:

```bash
aws dynamodb delete-item \
  --table-name x402-rate-limits-prod \
  --key '{"accountId":{"S":"<tenant-uuid>"}}'
```

The next request will create a fresh bucket at full capacity.

### Reset IP-Based Rate Limits

Signup and admin endpoints use IP-based keys:

```bash
# Reset signup rate limit for an IP
aws dynamodb delete-item \
  --table-name x402-rate-limits-prod \
  --key '{"accountId":{"S":"signup#1.2.3.4"}}'

# Reset admin rate limit for an IP
aws dynamodb delete-item \
  --table-name x402-rate-limits-prod \
  --key '{"accountId":{"S":"admin#1.2.3.4"}}'
```

---

## Health Check Failures

### GET /v1/health (Liveness)

Returns `{ok: true}` if the Lambda is running. If this fails, the Lambda itself is broken.

### GET /v1/health/ready (Readiness)

Probes three dependencies in parallel:

| Check     | What It Does                      | Failure Meaning                               |
| --------- | --------------------------------- | --------------------------------------------- |
| DynamoDB  | `DescribeTable` on payments table | DDB is unreachable or IAM is broken           |
| Secrets   | Fetches agent wallet secret       | Secrets Manager unreachable or secret deleted |
| Chain RPC | Calls `eth_blockNumber`           | Base RPC endpoint is down or URL is wrong     |

**Response:** 200 if all pass, 503 if any fail. Body includes per-check `ok`, `latencyMs`, and `error`.

**Triage:**

1. If DynamoDB fails: check VPC endpoints, IAM role, table existence.
2. If Secrets fails: check secret ARN in env var, IAM permissions, secret existence.
3. If Chain RPC fails: check `BASE_RPC_SECRET_ARN`, verify the RPC URL, check provider status page.

---

## Disaster Recovery (DR/RTO/RPO)

### Architecture Overview

x402 is a **single-region** deployment. All resources (Lambda, API Gateway, DynamoDB, Secrets Manager) reside in one AWS region. There is no active-passive or active-active multi-region failover.

**Stateful resources:**

| Resource               | Backup Mechanism                      | RPO         |
| ---------------------- | ------------------------------------- | ----------- |
| 10 DynamoDB tables     | Point-in-time recovery (PITR)         | ~5 minutes  |
| 9 Secrets Manager keys | Versioned by AWS (no explicit backup) | 0 (durable) |
| SQS DLQs (2)           | 14-day message retention              | N/A         |

**Stateless resources:** Lambda functions, API Gateway, WAF, CloudWatch alarms/dashboards, EventBridge rules. All are defined in CDK and can be redeployed from code.

### Recovery Objectives

| Scenario                         | RTO Target | RPO Target | Notes                                                      |
| -------------------------------- | ---------- | ---------- | ---------------------------------------------------------- |
| Bad deployment (Lambda bug)      | < 15 min   | 0          | Redeploy previous CDK artifact                             |
| DynamoDB table corruption/delete | < 1 hour   | ~5 min     | PITR restore to new table, swap references                 |
| Secrets Manager key deletion     | < 30 min   | 0          | Recreate secret, force Lambda cold starts                  |
| Full region outage               | 4-8 hours  | ~5 min     | Redeploy stack to alternate region + restore DDB from PITR |
| Accidental `cdk destroy`         | < 2 hours  | ~5 min     | Prod tables use RETAIN policy, redeploy stack              |

### DynamoDB Backup and Restore

All 10 tables have PITR enabled, allowing restore to any second within the last 35 days.

**Tables:** payments, tenants, routes, usage, rate-limits, idempotency, fraud-events, fraud-tally, agent-nonces, webhook-dlq

#### Restore a Table to a Point in Time

```bash
# 1. Restore to a new table (cannot restore in-place)
aws dynamodb restore-table-to-point-in-time \
  --source-table-name x402-payments-prod \
  --target-table-name x402-payments-prod-restored \
  --restore-date-time "2026-04-10T00:00:00Z"

# 2. Wait for restore to complete (CREATING → ACTIVE)
aws dynamodb describe-table \
  --table-name x402-payments-prod-restored \
  --query "Table.TableStatus"

# 3. Verify row counts match expectations
aws dynamodb describe-table \
  --table-name x402-payments-prod-restored \
  --query "Table.ItemCount"
```

#### Swap Restored Table into Service

DynamoDB does not support renaming tables. Options:

**Option A — Update CDK stack to point to restored table:**

1. Update the table name in the CDK construct to reference `x402-payments-prod-restored`.
2. Run `npx cdk deploy --context stage=prod`.
3. Lambda env vars update, triggering cold starts that pick up the new table.

**Option B — Copy data back to original table:**

```bash
# Export restored table to S3
aws dynamodb export-table-to-point-in-time \
  --table-arn arn:aws:dynamodb:<region>:<account>:table/x402-payments-prod-restored \
  --s3-bucket x402-backup-<account> \
  --export-format DYNAMODB_JSON

# Delete corrupted items from original, then import
# (For small tables, use a scan+batch-write script instead)
```

**Option C — For small tables (< 10K items), direct copy:**

```bash
# Scan restored → batch-write to original
aws dynamodb scan --table-name x402-payments-prod-restored \
  --output json > /tmp/restored-items.json
# Use a script to batch-write items back to x402-payments-prod
```

#### On-Demand Backup (Pre-Maintenance)

Before risky operations (schema migrations, bulk deletes), take an explicit backup:

```bash
aws dynamodb create-backup \
  --table-name x402-payments-prod \
  --backup-name "pre-maintenance-$(date +%Y%m%d-%H%M%S)"

# List backups
aws dynamodb list-backups \
  --table-name x402-payments-prod
```

### Secrets Recovery

Secrets Manager retains deleted secrets for a recovery window (default 30 days).

```bash
# Recover a recently deleted secret
aws secretsmanager restore-secret \
  --secret-id x402/prod/agent-wallet

# If the secret is permanently gone, recreate it
aws secretsmanager create-secret \
  --name x402/prod/agent-wallet \
  --secret-string '{"privateKey":"0x..."}'

# Force Lambda cold starts to pick up the new secret
aws lambda update-function-configuration \
  --function-name x402-api-prod \
  --environment "Variables={FORCE_RESTART=$(date +%s)}"
```

Repeat the `update-function-configuration` for all 5 functions if the secret is shared.

### Single-Region Recovery (Full Redeployment)

If the entire stack is lost but the AWS account and region are intact:

1. **Restore DDB tables** from PITR (production tables survive `cdk destroy` due to `RETAIN` policy).
2. **Recreate secrets** in Secrets Manager from your secure vault/1Password.
3. **Redeploy the CDK stack:**
   ```bash
   npx cdk bootstrap aws://<account>/<region>
   npx cdk deploy --context stage=prod --all
   ```
4. **Run smoke test:**
   ```bash
   BASE_URL=https://<new-api-domain> node scripts/smoke-test.js --strict
   ```
5. **Update DNS** if the API Gateway domain changed.
6. **Verify health:** `curl https://<api-domain>/v1/health/ready | jq .`

### Cross-Region Failover

x402 does not currently have automated cross-region failover. Manual failover procedure:

1. **Bootstrap CDK in the target region:**

   ```bash
   npx cdk bootstrap aws://<account>/<target-region>
   ```

2. **Restore DDB tables** using PITR or on-demand backups. Note: PITR restores are same-region only. For cross-region, use DynamoDB Export to S3 + Import:

   ```bash
   # Export from source region
   aws dynamodb export-table-to-point-in-time \
     --table-arn arn:aws:dynamodb:<source-region>:<account>:table/x402-payments-prod \
     --s3-bucket x402-backup-<account> \
     --s3-prefix exports/ \
     --export-format DYNAMODB_JSON

   # Import in target region
   aws dynamodb import-table \
     --s3-bucket-source S3Bucket=x402-backup-<account>,S3KeyPrefix=exports/ \
     --input-format DYNAMODB_JSON \
     --table-creation-parameters '{"TableName":"x402-payments-prod","KeySchema":[...],"AttributeDefinitions":[...],"BillingMode":"PAY_PER_REQUEST"}'
   ```

3. **Recreate secrets** in the target region's Secrets Manager.

4. **Deploy CDK stack** to target region:

   ```bash
   AWS_DEFAULT_REGION=<target-region> npx cdk deploy --context stage=prod --all
   ```

5. **Update DNS / API consumers** to point to the new API Gateway endpoint.

6. **Run smoke test** against the new region.

### Preventive Measures

- **Production tables use `RemovalPolicy.RETAIN`** — `cdk destroy` will not delete them.
- **PITR is enabled on all 10 tables** — continuous backups for the last 35 days.
- **Secrets Manager deletion protection** — secrets have a 30-day recovery window by default.
- **Take on-demand DDB backups** before any maintenance or migration.
- **Test restores quarterly** — restore one table to verify PITR works and data is intact.

---

## Useful Commands

### View Recent Payments

```bash
aws dynamodb scan \
  --table-name x402-payments-prod \
  --limit 20 \
  --scan-filter '{"createdAt":{"AttributeValueList":[{"S":"2026-04-01"}],"ComparisonOperator":"GE"}}'
```

### List All Tenants

```bash
aws dynamodb scan \
  --table-name x402-tenants-prod \
  --projection-expression "accountId, #p, createdAt" \
  --expression-attribute-names '{"#p":"plan"}'
```

### Check Agent Wallet Nonce

```bash
aws dynamodb get-item \
  --table-name x402-agent-nonces-prod \
  --key '{"walletAddress":{"S":"<wallet-address>"}}'
```

### Invoke Health Check

```bash
curl -s https://<api-domain>/v1/health/ready | jq .
```

### Trigger DLQ Sweep Manually

```bash
aws lambda invoke \
  --function-name x402-dlq-sweep-prod \
  --payload '{}' \
  /dev/stdout
```

### View Fraud Events for a Tenant

```bash
aws dynamodb query \
  --table-name x402-fraud-events-prod \
  --key-condition-expression "accountId = :id" \
  --expression-attribute-values '{":id":{"S":"<tenant-uuid>"}}'
```
