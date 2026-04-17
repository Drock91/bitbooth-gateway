# ADR-0001: x402 challenge design

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** x402 gateway team

## Context

HTTP 402 "Payment Required" has existed as a reserved status code for decades
without a concrete protocol. For an agent-to-API gateway to be useful across
chains and clients, the challenge response must tell the paying client
everything it needs — where to pay, how much, on which rail, until when —
without a second round-trip, and without privileging a single chain. Three
constraints shaped the decision:

1. We settle on multiple rails (Base mainnet USDC, XRPL EVM sidechain, native
   XRPL in XRP/USDC/RLUSD, Solana USDC). A client holding funds on any one
   rail should be able to pay without negotiating a preferred rail up front.
2. Replay protection must be server-side authoritative. Client nonces that
   drift with clocks or survive across deploys cause real incidents.
3. We want parity with Coinbase's emerging x402 convention so agents written
   against their spec work here too.

See `src/middleware/x402.middleware.js` (`buildChallenge`) and
`src/validators/payment.schema.js` for the concrete implementation.

## Decision

A 402 response carries a single JSON body with:

- a server-minted `nonce` (cryptographically random, stored in the `payments`
  table keyed on nonce for replay detection),
- `expiresAt` (unix seconds, `cfg.x402.paymentWindowSeconds` from now —
  default 120s, matching the replay-window non-negotiable in `CLAUDE.md`),
- `resource` (the path being paid for),
- `amountWei` + `assetSymbol` for legacy/single-rail clients,
- **an `accepts[]` array of per-rail entries** (`scheme`, `network` in
  CAIP-2 form, `payTo`, `asset`, `amount`).

The client picks one entry, submits the signed payment in a header
`X-PAYMENT: <json>`, and the gateway routes verification by the entry's
`network` prefix through `chainRouter` in `src/services/routing.service.js`.
Verification is atomic: nonce reuse check → fraud pre-checks → chain adapter
`verifyPayment` → record to `payments` table → usage increment. Any step's
failure aborts and re-issues a challenge.

## Alternatives considered

- **Single-rail `X-PAYMENT-CHAIN` negotiation header.** Simpler response, but
  forces a round-trip for any client that cannot pay on the gateway's default
  rail. Rejected: agent clients often negotiate once and cache; the extra
  round-trip kills throughput.
- **Client-minted nonces with server replay window.** Matches the Solana Pay
  model. Rejected: clients' clocks drift and replay protection in a
  distributed Lambda fleet becomes a coordination problem; a DDB-backed
  server nonce is simpler and cheaper than a clock-skew-safe client scheme.
- **Per-rail endpoints (`/v1/resource/base`, `/v1/resource/xrpl`).**
  Rejected: client and route fan-out explode with each new chain; `accepts[]`
  scales by adding a map entry.

## Consequences

- **Positive:** adding a new chain is one adapter module + one `chainRouter`
  entry + one conditional push into `accepts[]`. No client changes needed for
  existing clients to continue paying on their chosen rail.
- **Positive:** replay protection is authoritative — a reused nonce is also a
  fraud signal (`trackNonceFailure`) that can trigger account flags.
- **Negative:** `accepts[]` grows with chains, making the 402 body larger.
  Current size (~4 entries × ~200 bytes) is negligible; a hypothetical 20-rail
  future would warrant a rails-index lookup.
- **Negative:** server-minted nonces require a DDB write per challenge issued,
  even when the client walks away. Mitigated by the 2-minute TTL on the
  `payments` nonce index.
- **Neutral:** we deliberately mirror Coinbase's x402 `accepts[]` key names so
  agent SDKs built for their spec interoperate.

## Follow-ups

- Route-level overrides of the `accepts[]` list (per-route asset restrictions)
  — not yet implemented; see `route.fraudRules` for the existing per-route
  override pattern.
- Signed 402 body so clients can verify the gateway's challenge is authentic
  before spending — deferred until a concrete threat model emerges.
