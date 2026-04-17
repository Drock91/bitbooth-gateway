---
name: xrpl-evm
description: Integrate with the XRPL EVM Sidechain (EVM-compatible, chainId 1440002). Use when submitting transactions, reading receipts, managing agent wallet nonces, or verifying payments. Encapsulates ethers usage behind one adapter.
---

# XRPL EVM Sidechain

## Facts

- **Chain ID:** `1440002` (mainnet-candidate; verify current at rollout)
- **Native gas token:** XRP (bridged)
- **Default RPC:** `https://rpc-evm-sidechain.xrpl.org`
- **Finality target:** ~3–5s block time; use 2 confirmations for micropayments, 12 for treasury.

## Rules

- **Only** import `ethers`/`viem` inside `src/adapters/xrpl-evm/`. The ESLint rule `no-restricted-imports` enforces this.
- Agent wallet key is ALWAYS loaded from Secrets Manager via `getSecretJson()` — never from env.
- Track submitted nonces in DDB (`agent-nonces` table keyed by wallet address). Do not rely on provider's `getTransactionCount` for bursty writes.
- Every outbound tx records: `txHash`, `nonce`, `submittedAt`, `status` in the `tx-log` table.

## Idioms

```ts
import { verifyPayment } from '@/adapters/xrpl-evm';

const result = await verifyPayment({
  txHash,
  expectedTo: payTo,
  expectedAmountWei: BigInt(amountWei),
  minConfirmations: 2,
});
```

## Cross-chain (Axelar) notes

- If routing in from another chain via Axelar GMP, wait for **destination-chain** confirmations, not source.
- Use Axelar's `executed` event on destination to trigger credit, not source tx hash.
