# x402 Integration Guide

> Get your first paid API call working in 5 minutes.

## 1. Create an Account

```
POST /dashboard/signup
```

No authentication required. Returns an HTML page containing:

- **Account ID** (UUID)
- **API Key** (`x402_<hex>`) — shown only once, save it immediately
- **Plan** — starts on `free`

## 2. Authenticate Requests

Add the `X-API-Key` header to every request:

```
X-API-Key: x402_your_api_key_here
```

The key is SHA-256 hashed and looked up server-side. Invalid or missing keys return **401 UNAUTHORIZED**.

## 3. The 402 Payment Flow

### Step A — Request a resource

```
POST /v1/resource
X-API-Key: x402_...
```

The server responds with **402 Payment Required** and a challenge body:

```json
{
  "error": {
    "code": "PAYMENT_REQUIRED",
    "details": {
      "nonce": "abc123...",
      "amountWei": "1000000",
      "assetSymbol": "USDC",
      "payTo": "0x...",
      "chainId": 1440002,
      "expiresAt": 1712364120,
      "resource": "/v1/resource"
    }
  }
}
```

### Step B — Pay on-chain

Send a USDC transfer on XRPL EVM (chain ID `1440002`) for `amountWei` to the `payTo` address. Include the `nonce` in your transaction memo or track it client-side.

### Step C — Prove payment

Retry the same request with the `X-PAYMENT` header:

```
POST /v1/resource
X-API-Key: x402_...
X-PAYMENT: {"nonce":"abc123...","txHash":"0x...","signature":"..."}
```

The server verifies the on-chain transaction (requires 2 block confirmations), then returns:

```json
{ "paid": true, "txHash": "0x..." }
```

**Important:** Nonces are single-use. Replaying a nonce returns a new 402 challenge and increments your fraud counter.

## 4. Rate Limits

Limits are enforced per-account via a token-bucket algorithm:

| Plan    | Requests/min | Burst capacity |
| ------- | ------------ | -------------- |
| free    | 10           | 10             |
| starter | 100          | 100            |
| growth  | 500          | 500            |
| scale   | 2000         | 2000           |

When exhausted, the server returns **429 RATE_LIMITED** with a `Retry-After` header (seconds until the next token is available).

Upgrade your plan via Stripe subscription to increase limits.

## 5. Fraud Protection

The server applies per-account fraud rules before processing payments:

| Rule                      | Default limit | Error                       |
| ------------------------- | ------------- | --------------------------- |
| Payments per minute       | 5             | 403 FRAUD_DETECTED (high)   |
| Payments per hour         | 60            | 403 FRAUD_DETECTED (medium) |
| Nonce failures per minute | 3             | 403 FRAUD_DETECTED (high)   |
| Amount below minimum      | 1000 wei      | 403 FRAUD_DETECTED          |
| Amount above maximum      | 100 USDC      | 403 FRAUD_DETECTED          |

If you hit a fraud block, wait for the window to expire or contact support.

## 6. Idempotency

For safe retries, add an `Idempotency-Key` header (UUID format):

```
POST /v1/resource
X-API-Key: x402_...
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
X-PAYMENT: {"nonce":"...","txHash":"0x...","signature":"..."}
```

Behavior:

- **First request**: processed normally, response cached for 24 hours.
- **Duplicate while in-flight**: returns **409 CONFLICT**.
- **Duplicate after completion**: returns the cached response with `x-idempotent-replay: true` header.

## 7. Error Reference

All errors follow this shape:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  },
  "correlationId": "uuid"
}
```

| Code             | HTTP | Meaning                                      |
| ---------------- | ---- | -------------------------------------------- |
| VALIDATION_ERROR | 400  | Request body/params failed schema validation |
| UNAUTHORIZED     | 401  | Missing or invalid API key                   |
| PAYMENT_REQUIRED | 402  | x402 challenge — pay and retry               |
| FRAUD_DETECTED   | 403  | Fraud rule triggered                         |
| NOT_FOUND        | 404  | Route or resource not found                  |
| CONFLICT         | 409  | Idempotency key already in-flight            |
| RATE_LIMITED     | 429  | Token bucket exhausted                       |
| INTERNAL_ERROR   | 500  | Server error                                 |
| UPSTREAM_ERROR   | 502  | Exchange or chain provider failed            |

## 8. Quick Reference

```
Base URL:         https://<your-domain>
Auth header:      X-API-Key: x402_...
Payment header:   X-PAYMENT: {"nonce":"...","txHash":"0x...","signature":"..."}
Idempotency:      Idempotency-Key: <UUID>
Chain:            XRPL EVM (chainId 1440002)
Asset:            USDC
Confirmations:    2 blocks (micropayments)
Nonce window:     120 seconds
Idempotency TTL:  24 hours
```

### Endpoints

| Method | Path                    | Auth      | Description                 |
| ------ | ----------------------- | --------- | --------------------------- |
| POST   | /dashboard/signup       | none      | Create account, get API key |
| GET    | /dashboard              | none      | Tenant dashboard (HTML)     |
| POST   | /v1/resource            | API key   | Paywalled resource (x402)   |
| POST   | /v1/quote               | API key   | Fiat-to-crypto quote        |
| GET    | /v1/health              | none      | Health check                |
| POST   | /v1/webhooks/stripe     | signature | Stripe subscription events  |
| POST   | /v1/webhooks/{provider} | signature | Exchange webhooks           |
