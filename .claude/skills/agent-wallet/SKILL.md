---
name: agent-wallet
description: Design and operate agent/machine wallets for x402. Use when provisioning new agent wallets, rotating keys, setting spend limits, or tying an agent identity to an OWS DID.
---

# Agent Wallet

An **agent wallet** is an EVM keypair controlled by an AI/machine identity, used to pay for x402-protected resources.

## Principles

- **One wallet per agent.** No shared treasuries. Makes blast radius finite.
- **Daily spend caps.** Enforced service-side before submitting a tx.
- **Per-destination allowlist** (optional but recommended).
- **Rotatable.** Keys rotate on schedule; old keys drain to the new wallet then get purged.

## Provisioning

1. Generate keypair offline OR inside a Lambda with KMS-backed generation.
2. Write private key JSON to Secrets Manager at `x402/<stage>/agents/<agentId>`.
3. Fund initial gas + small stablecoin balance via onramp adapter.
4. Register OWS DID pointing at the wallet in `accounts` table.

## OWS binding

```ts
import { owsAdapter } from '@/adapters/ows';

const account = owsAdapter.parseAccount({
  did: 'did:ows:...',
  address: '0x...',
  chain: 'xrpl-evm',
  capabilities: ['sign', 'pay'],
});
```

The DID is the stable identifier; the wallet address can rotate.

## Guardrails to implement

- Per-agent daily spend cap in DDB; decremented pre-submit.
- Alarm on unusual outbound volume via CloudWatch.
- "Pause agent" kill switch: flip a flag in DDB, middleware refuses new submissions.
