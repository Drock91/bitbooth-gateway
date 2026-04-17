---
name: exchange-adapter
description: Add or modify an exchange/onramp integration (Moonpay, Coinbase, Kraken, Binance, Binance US, Uphold). Use when wiring a new provider, changing quote logic, or verifying webhooks. Enforces the common ExchangeAdapter contract.
---

# Exchange Adapter

All exchanges implement `ExchangeAdapter` from `src/adapters/types.ts`:

```ts
interface ExchangeAdapter {
  readonly name: string;
  quote(input): Promise<ExchangeQuote>;
  executeBuy(input): Promise<{ orderId: string }>;
  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean;
}
```

## Adding a new provider

1. Create `src/adapters/<name>/client.ts` implementing the interface.
2. Credentials come from Secrets Manager only. ARN wired via `src/lib/config.ts` → `secretArns.<name>`.
3. Parse EVERY upstream response through a Zod schema co-located as `schemas.ts`.
4. Register in `src/services/routing.service.ts` `registry`.
5. Add a webhook path in CDK if the provider posts webhooks: `POST /v1/webhooks/<name>`.
6. Add unit tests with mocked credentials + at least one recorded fixture.
7. Update `.env.example` with the new secret ARN var.

## Webhook verification rules

- Verify **before** parsing the body as business data.
- Use `timingSafeEqual` from `src/lib/crypto.ts`.
- Reject with 401 on failure; never 200.
- Webhook handler is its own Lambda with narrower IAM (only reads that provider's secret).

## Per-provider signature headers

| Provider | Header                 | Algorithm            |
| -------- | ---------------------- | -------------------- |
| Moonpay  | `moonpay-signature-v2` | HMAC-SHA256          |
| Coinbase | `cb-signature`         | HMAC-SHA256          |
| Kraken   | `kraken-signature`     | HMAC-SHA512 (base64) |
| Binance  | `binance-signature`    | HMAC-SHA256          |
| Uphold   | `uphold-signature`     | HMAC-SHA256          |

Always confirm against the provider's latest docs before shipping.
