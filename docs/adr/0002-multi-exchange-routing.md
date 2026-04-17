# ADR-0002: Multi-exchange quote routing

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** x402 gateway team

## Context

The `/v1/quote` endpoint answers "how much crypto does this fiat buy?" for
agent onramps. We integrate five exchange/onramp providers (Moonpay,
Coinbase, Kraken, Binance, Uphold) because:

- Each has regional coverage gaps; no single provider serves all agent
  geographies.
- Spreads and fees differ per asset and per day — a multi-provider quote
  comparison is a real product differentiator for fiat-in flows.
- Upstream availability is not 100%; a single-provider design creates a
  single point of failure for a whole business vertical.

But routing logic lives in `services/` per the dependency rules in
`CLAUDE.md`; it must not leak SDK types, must validate every upstream
response with Zod, and must degrade gracefully when any subset of providers
fails. See `src/services/routing.service.js` (`bestQuote`).

## Decision

Each provider exposes a common `ExchangeAdapter` shape
(`quote`, `executeBuy`, `verifyWebhook`) from `src/adapters/<name>/`. The
routing service holds a `registry` map of all adapters and, for each quote
request, calls `Promise.allSettled(Object.values(registry).map(a => a.quote(input)))`.
Fulfilled results are filtered, Zod-validated inside the adapter, and
compared on `cryptoAmount − feeFiat`. Rejected results are silently dropped
— they're already logged inside the adapter. If zero providers return a
valid quote, the service throws `UpstreamError('exchange', ...)` which the
error middleware maps to 503.

## Alternatives considered

- **Sequential fallback (primary → secondary → tertiary).** Simpler, but
  loses the price-discovery benefit; slow providers blow the request budget
  before a faster one can answer.
- **Pre-cached hourly quotes per (asset, fiat, country) triple.** Better p99
  latency, but stale quotes cause real PnL losses and compliance headaches if
  a provider rescinds a quote mid-flight. Rejected.
- **Client-side multi-request (agent calls five endpoints).** Pushes auth,
  rate-limiting, and response parsing onto clients. Rejected: violates the
  gateway's core value prop (one API, many rails).

## Consequences

- **Positive:** adding a sixth provider is one adapter module + one
  `registry` entry + one Secrets Manager entry. The `exchange-adapter` skill
  enforces the checklist.
- **Positive:** any provider outage is invisible to callers unless _all_
  providers fail simultaneously.
- **Positive:** `Promise.allSettled` gives us end-to-end latency of the
  slowest-valid provider, bounded by the adapter-level 10s HTTP timeout
  from G-072.
- **Negative:** cost per quote is N× upstream fees per request. For providers
  that meter quote endpoints (Binance), this matters at scale — tracked via
  `exchange.<name>.quote.failed` metrics and the per-adapter retry budget
  from `src/adapters/retry.js`.
- **Negative:** silent provider drop-outs can hide a systematic integration
  break — for example, a Zod schema drift that fails _every_ response from
  one provider. Mitigated by the exchange-adapter integration tests hitting
  recorded fixtures.
- **Neutral:** `bestQuote`'s comparator is pure `cryptoAmount − feeFiat`,
  ignoring settlement time and reputation. If a provider routinely settles
  slower, the gateway doesn't yet penalize it.

## Follow-ups

- Settlement-time-weighted scoring for `bestQuote` (currently pure price).
- Per-provider circuit breaker using the `CircuitBreaker` primitive from
  G-130 — adapters currently retry-then-surface; a tripped breaker would
  remove a flapping provider from the race entirely.
