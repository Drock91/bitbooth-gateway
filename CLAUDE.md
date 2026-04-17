# CLAUDE.md — x402 conventions

> **Read this first every session.** These are non-negotiables. If a rule conflicts with a user request, flag it.

## Departments (responsibility boundaries)

| Dept            | Owns                                                     | Never does                      |
| --------------- | -------------------------------------------------------- | ------------------------------- |
| `routes/`       | URL → controller mapping, auth middleware wiring         | business logic, DB access       |
| `controllers/`  | parse request, call service, shape response, HTTP codes  | talk to DB/chain directly       |
| `services/`     | business rules, orchestration, transactions              | know about HTTP or DynamoDB SDK |
| `adapters/`     | one external system each (exchange, chain, wallet)       | leak SDK types upward           |
| `middleware/`   | cross-cutting concerns (x402, auth, idempotency, errors) | own business state              |
| `validators/`   | Zod schemas, runtime-validated types                     | side effects                    |
| `repositories/` | DDB reads/writes; map DDB items <-> domain models        | business rules                  |
| `lib/`          | pure helpers: logger, config, errors, crypto             | I/O that belongs elsewhere      |

**Dependency direction:** `routes → controllers → services → (adapters, repositories) → lib`. Never the reverse.

## Non-negotiables

### Validation

- Every request body, query, and path param is parsed through a **Zod schema in `src/validators/`**. No exceptions.
- Controllers receive already-validated, typed input. If validation fails, a 400 with the Zod issue list is returned by the validation middleware.
- All adapter responses are also validated with Zod before returning to callers. External APIs lie.

### Security

- **No secrets in code.** All secrets in AWS Secrets Manager, loaded at cold start via `lib/config.ts`.
- **Least-privilege IAM per Lambda.** Each handler gets only the actions/resources it needs.
- **x402 endpoints require:** signature verification on the `X-PAYMENT` header, nonce check, replay window ≤ 120s, and idempotency key persisted in DDB with a TTL.
- **Webhooks** (Moonpay, Coinbase, etc.) verify HMAC/signature **before** any business logic runs. Reject with 401 on failure.
- **Never log:** API keys, private keys, signed payloads, full wallet seeds, raw user PII. Logger has a redaction list in `lib/logger.ts`.
- **Input size limits:** JSON body ≤ 100KB unless endpoint explicitly opts in.
- **Rate limits** via API Gateway usage plans + per-account token bucket in DDB.

### XRPL EVM settlement

- All chain interactions go through `adapters/xrpl-evm/`. Never import ethers/viem directly elsewhere.
- Submitted txs use `nonce` tracking via DDB (`agent-nonces` table) — never rely on the node for nonce.
- Confirmations required: **2 blocks** for micropayments, **12** for treasury moves.
- Every tx is recorded in `payments` table with `idempotencyKey`, `status`, `txHash`, `blockNumber`.

### Error handling

- Throw typed errors from `lib/errors.ts` (`ValidationError`, `PaymentRequiredError`, `NotFoundError`, `UpstreamError`, `ConflictError`).
- The error middleware maps them to HTTP codes. Controllers do NOT try/catch for HTTP mapping.
- Never swallow errors. Log once, at the middleware boundary, with correlation ID.

### Observability

- `pino` logger with `correlationId`, `route`, `accountId`, `idempotencyKey` on every log line.
- Every Lambda logs start/end + latency. Every adapter call logs duration + upstream status.
- Emit CloudWatch metrics: `x402.challenge.issued`, `x402.payment.verified`, `chain.tx.submitted`, `exchange.<name>.quote.failed`.

### Testing

- Unit tests for every service and adapter (mocks only at adapter boundaries).
- Integration tests hit LocalStack (DDB) + a test XRPL EVM devnet.
- Minimum 80% coverage on `services/` and `middleware/`.

### Definition of Done

A PR is mergeable only when:

1. `npm run lint` passes (no warnings).
2. `npm test` passes with coverage ≥ thresholds.
3. `npm audit --audit-level=high` returns 0.
4. `npm run build` succeeds (dist/ bundled).
5. `npm run cdk:synth` succeeds.
6. The `security-review` skill checklist is filled out in the PR body.
7. OpenAPI (`openapi.yaml`) is updated if routes changed.
8. No TypeScript files (`.ts`, `.tsx`, `tsconfig*.json`) introduced.

## Coding style

- **Pure JavaScript (ESM), no TypeScript.** Node 20+. `"type": "module"` in package.json; all imports use `.js` extensions.
- Runtime validation via Zod at every boundary (HTTP input, adapter responses, config from env).
- JSDoc `@typedef` comments in `src/types/` and `src/adapters/types.js` document shapes. No `.d.ts`.
- Async/await only. No `.then()` chains.
- Named exports. No default exports (except Lambda handlers).
- One domain concept per file. Files > 300 lines get split.
- Functions > 40 lines get refactored unless they're clearly a saga.

## When adding a new exchange/onramp

1. Create `src/adapters/<name>/` implementing the `ExchangeAdapter` interface from `src/adapters/types.ts`.
2. Add a Zod schema for its response shapes in the adapter's `schemas.ts`.
3. Register it in `src/services/routing.service.ts`.
4. Add its credentials as a Secrets Manager entry and wire into `lib/config.ts`.
5. Add unit tests + a recorded-fixture integration test.
6. Update `.claude/skills/exchange-adapter/SKILL.md` if the new adapter needed new patterns.

## When adding a new route

1. Define Zod schema in `src/validators/`.
2. Add service method in `src/services/`.
3. Add controller in `src/controllers/`.
4. Wire route in `src/routes/`.
5. Add Lambda handler in `src/handlers/` if it's its own function.
6. Add CDK API GW route + Lambda in `infra/stacks/`.
7. Write unit + integration tests.
8. Update `openapi.yaml`.
