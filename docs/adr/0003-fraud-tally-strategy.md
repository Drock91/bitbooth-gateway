# ADR-0003: Fraud tally strategy

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** x402 gateway team

## Context

Agent traffic is adversarial by default: cheap nonce reuse probes, velocity
bursts to discover rate-limit bounds, and amount-out-of-range tests to find
fraud rule edges. The gateway needs near-real-time fraud detection that:

- Is cheap enough to run on every paid request (p99 ≤ 30ms).
- Tolerates Lambda concurrency — multiple concurrent requests from the same
  account must converge on an accurate counter, not race to a stale read.
- Lets us tune per-route thresholds without a deploy (see
  `route.fraudRules` override pattern).
- Doesn't hoard data: fraud events are auditable but not a long-term store.

See `src/services/fraud.service.js`, `src/repositories/fraud.repo.js`, and
the `FraudTally` + `FraudEvents` DDB tables in `infra/stacks/tables.js`.

## Decision

Tallies are **DDB atomic counters keyed by `accountId + window-bucket`**,
where the window bucket is a string-derived-from-time:

- **Minute window:** `velocity:2026-04-16T17:42` — the ISO timestamp sliced
  to minute precision.
- **Hour window:** `velocity-h:2026-04-16T17` — sliced to hour precision.
- **Nonce failures:** `nonce-fail:<minute>` — independent tally, independent
  threshold.

Every paid request issues `UpdateItem` with `ADD eventCount :one` against
the current bucket. The SDK returns the post-increment value; if it exceeds
the configured threshold, the service writes a row to `FraudEvents` and
throws `FraudDetectedError`. Buckets carry a 30-day TTL
(`FRAUD_TTL_SECONDS`, externalized in G-069).

Thresholds come from a merge of `DEFAULT_RULES` (env-var-driven, from G-039)
and per-route `fraudRules` overrides.

## Alternatives considered

- **Sliding window over an `events` table.** Accurate to the second but
  requires a `Query` per request with a range scan; p99 regresses to ~80ms
  under load. Rejected.
- **Redis-backed counters (ElastiCache).** Faster than DDB on the hot path,
  but adds an always-on VPC dependency to a stateless Lambda fleet — we'd
  lose cold-start on demand and pay for idle capacity. Rejected for
  current scale; revisitable if p99 DDB writes ever become the bottleneck.
- **In-memory counters per Lambda instance.** Breaks under concurrency; two
  instances see half the traffic each and neither trips.
- **Token bucket (matching the rate-limiter).** The rate-limiter already
  enforces request budget; fraud detection wants different signal
  (velocity/amount anomaly, not just "too many"). Keeping them as separate
  systems lets them evolve independently.

## Consequences

- **Positive:** a single `UpdateItem` per request is O(1) and commutes
  across concurrent callers — the DDB atomic `ADD` is the correctness
  guarantee.
- **Positive:** the tally key-space is self-sweeping via TTL; no batch job
  to prune.
- **Positive:** env-var-driven thresholds + per-route overrides mean ops
  can retune without code deploy.
- **Negative:** tumbling windows (not sliding) mean a burst straddling a
  minute boundary passes unless the hour-window also trips. The dual
  (minute + hour) tally is the compromise — picks up both
  burst-inside-a-minute and sustained-over-an-hour patterns while keeping
  write cost to two updates per request.
- **Negative:** the recorded `FraudEvent` is lossy — it captures the rule
  that tripped, not the surrounding context. Triage beyond "which account,
  which rule" requires joining to `payments` and CloudWatch logs.
- **Neutral:** the amount-bounds check (`checkAmount`) is pure function, no
  DDB access. It's colocated in `fraud.service.js` only because it shares
  the `FraudDetectedError` exit path; architecturally it's a validator.

## Follow-ups

- ML-assisted anomaly scoring on the `payments` table beyond hard-coded
  thresholds — explicitly deferred until we have ≥ 30 days of production
  payment data.
- Per-tenant override of rule _types_ (not just thresholds) — some enterprise
  tenants may want stricter nonce-failure handling. Currently we overload
  `fraudRules` per-route; a per-tenant rule set is the natural next step.
