---
name: x402-payments
description: Implement and review x402 (HTTP 402 Payment Required) flows for agent/machine payments. Use when adding a new paid endpoint, changing the challenge/response, or auditing x402 security. Covers challenge issuance, nonce/replay protection, signature verification, and settlement on XRPL EVM.
---

# x402 Payments

## Flow

1. Client hits a protected endpoint with no `X-PAYMENT` header.
2. Server returns `402 Payment Required` with a JSON body containing a **challenge**:
   ```json
   {
     "nonce": "<16-byte hex>",
     "amountWei": "<string>",
     "assetSymbol": "USDC",
     "payTo": "0x...",
     "chainId": 1440002,
     "expiresAt": <unix seconds>,
     "resource": "/v1/resource"
   }
   ```
   Also sets header `WWW-Authenticate: X402`.
3. Client submits an on-chain transfer on XRPL EVM to `payTo` for `amountWei`.
4. Client retries the request with header `X-PAYMENT: <json{nonce,txHash,signature}>`.
5. Server verifies: nonce unused → tx exists → recipient matches → amount ≥ required → confirmations ≥ configured → persist nonce as spent.
6. Server executes business logic and returns 200.

## Required checks (all must pass)

- Nonce not present in `payments` DDB table.
- `expiresAt` has not passed (window ≤ 120s by default).
- `tx.to === payTo` (case-insensitive).
- `tx.value >= amountWei`.
- `confirmations >= X402_REQUIRED_CONFIRMATIONS` (default 2).
- Idempotent insert: `ConditionExpression: attribute_not_exists(idempotencyKey)`.

## Common mistakes to avoid

- Accepting a tx hash without fetching it from the RPC (trusting the client).
- Skipping the confirmations check.
- Not persisting the nonce before running business logic (replay).
- Logging the raw `X-PAYMENT` header value.
- Using `==` on signatures/hashes; always `timingSafeEqual`.

## Where in this repo

- Middleware: `src/middleware/x402.middleware.ts`
- Chain verify: `src/adapters/xrpl-evm/client.ts#verifyPayment`
- Persistence: `src/repositories/payments.repo.ts`
- Response helper: `src/middleware/error.middleware.ts#paymentRequiredResponse`
