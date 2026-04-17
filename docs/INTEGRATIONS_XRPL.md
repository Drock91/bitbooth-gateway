# XRPL Integration — USDC and RLUSD

BitBooth accepts payments on the native XRP Ledger in three settlement tokens:

- **XRP** (drops, 1e6 drops = 1 XRP) — always available as a fallback.
- **USDC** — Circle's XRPL-native USD Coin, issued by Circle's XRPL issuer account.
- **RLUSD** — Ripple USD, issued by Ripple's RLUSD issuer account.

The gateway emits one entry in the 402 challenge `accepts[]` array for each
configured stablecoin. Agents pay in whichever they hold; the gateway verifies
the delivered `TransferAmount` against the configured issuer whitelist.

## Configuration

| Env var             | Purpose                           | Example                              |
| ------------------- | --------------------------------- | ------------------------------------ |
| `XRPL_PAY_TO`       | Payment destination (agent addr)  | `rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1` |
| `XRPL_USDC_ISSUER`  | Circle's XRPL USDC issuer address | `rcEGREd8NmkKRE8GE424sksyt1tJVFZwu`  |
| `XRPL_RLUSD_ISSUER` | Ripple's RLUSD issuer address     | `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De` |

All three are optional. Leave issuers unset to disable that specific
stablecoin. With no issuer configured the gateway falls back to XRP drops
settlement only.

These values are public XRPL addresses. They are loaded from environment
variables at cold start (typically sourced from Secrets Manager entries so
operators can rotate issuer mappings without a code deploy).

## Trust lines

XRPL IOUs require each holder to open a **trust line** to the issuer before
tokens can be received or held. Our agent wallet therefore needs trust lines
for each stablecoin it accepts.

### Circle USDC (mainnet)

Issuer: `rcEGREd8NmkKRE8GE424sksyt1tJVFZwu`
Currency code: `USD`
Verify the current official issuer in Circle's documentation before setting
trust lines in prod.

```json
{
  "TransactionType": "TrustSet",
  "Account": "<agent wallet>",
  "LimitAmount": {
    "currency": "USD",
    "issuer": "rcEGREd8NmkKRE8GE424sksyt1tJVFZwu",
    "value": "10000000"
  }
}
```

### Ripple RLUSD (mainnet)

Issuer: `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De`
Currency code: `RLUSD`
Verify the current official issuer in Ripple's documentation before setting
trust lines in prod.

```json
{
  "TransactionType": "TrustSet",
  "Account": "<agent wallet>",
  "LimitAmount": {
    "currency": "RLUSD",
    "issuer": "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
    "value": "10000000"
  }
}
```

### Operations

1. Fund the agent wallet with enough XRP to cover base reserve (currently
   10 XRP) plus 2 XRP per trust line.
2. Sign and submit a `TrustSet` for each currency.
3. Wait for ledger validation (~4 seconds).
4. Confirm the trust line with `account_lines` on the agent address.

See `scripts/ops/trust-line.js` if you need a one-off script.

## 402 challenge shape

With both issuers configured, the 402 challenge for a `/v1/fetch` request
includes four rails:

```json
{
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "payTo": "0x...",
      "asset": "USDC@0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "5000"
    },
    {
      "scheme": "exact",
      "network": "solana:5eykt4Us...",
      "payTo": "So1ana...",
      "asset": "USDC@EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "amount": "5000"
    },
    {
      "scheme": "exact",
      "network": "xrpl:0",
      "payTo": "rU6K7V3Po...",
      "asset": "USDC@rcEGREd8Nm...",
      "amount": "5000"
    },
    {
      "scheme": "exact",
      "network": "xrpl:0",
      "payTo": "rU6K7V3Po...",
      "asset": "RLUSD@rMxCKbEDwq...",
      "amount": "5000"
    }
  ]
}
```

Agents pick one rail, settle, and return the `txHash` in the `X-PAYMENT`
header. The gateway verifies the delivered amount is an IOU matching one of
the configured `{ currency, issuer }` tuples.

## Verification contract

`src/adapters/xrpl/client.js` accepts an optional `allowed` array:

```js
await verifyPayment({
  txHash,
  destination: agentAddr,
  allowed: [
    { currency: 'USD', issuer: usdcIssuer, value: '0.005' },
    { currency: 'RLUSD', issuer: rlusdIssuer, value: '0.005' },
  ],
});
```

The delivered amount must match exactly one of the `allowed` entries —
currency, issuer, and value (`>= expected`). Any tx whose `delivered_amount`
lists an unknown issuer is rejected with `amount-mismatch`.

## Testnet

The testnet uses CAIP-2 `xrpl:1` (WebSocket at
`wss://s.altnet.rippletest.net:51233`). Devnet RLUSD issuers differ from
mainnet; confirm with the RLUSD issuer registry before configuring staging.
