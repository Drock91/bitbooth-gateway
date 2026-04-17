---
name: security-review
description: Pre-merge security checklist for x402. Use before opening or merging any PR. Runs through input validation, auth, secrets, IAM, chain verification, webhook verification, logging, and rate limiting.
---

# Security Review Checklist

Fill this out in every PR description. No "N/A" without a reason.

## Inputs

- [ ] Every new/changed request body/query/path is parsed through a Zod schema.
- [ ] Max body size enforced (≤ 100KB unless explicit).
- [ ] No `any` added. `unknown` used at boundaries.

## Auth & identity

- [ ] All new endpoints specify auth (API key, OWS DID, or explicit public).
- [ ] `authenticate()` runs BEFORE any business logic.
- [ ] API keys are looked up server-side, not trusted from header alone.

## Secrets & IAM

- [ ] Zero secrets in code, env-inline, or logs.
- [ ] New Lambdas have scoped IAM (resource + action specific).
- [ ] New Secrets Manager entries follow `x402/<stage>/<name>` naming.

## x402 / Chain

- [ ] Nonce persisted atomically (`attribute_not_exists` condition).
- [ ] Confirmations check present and ≥ configured minimum.
- [ ] Recipient & amount verified against fetched tx, not client claim.
- [ ] `X-PAYMENT` header never logged.

## Webhooks

- [ ] Signature verified BEFORE any business logic.
- [ ] `timingSafeEqual` used for comparison.
- [ ] 401 returned on failure (not 200/400).

## Logging & errors

- [ ] No secrets, keys, signatures, PII, or raw payment headers in logs.
- [ ] Typed errors used; no raw `throw new Error(...)` in controllers/services.
- [ ] Correlation ID propagated.

## Rate limiting & abuse

- [ ] New public endpoint is behind API Gateway throttling or per-account bucket.
- [ ] Idempotency key required on mutating endpoints.

## Dependencies

- [ ] `npm audit --audit-level=high` passes.
- [ ] No new direct imports of `ethers`/`viem` outside `adapters/xrpl-evm/`.

## Tests

- [ ] Unit tests cover the happy path + at least one failure path.
- [ ] Coverage thresholds still pass.
