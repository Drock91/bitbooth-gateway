---
name: Add a new chain
about: Request support for a new payment rail (Solana mainnet, Stellar, Lightning, etc.)
title: '[CHAIN] add support for '
labels: enhancement, chain-adapter
assignees: ''
---

## Chain

- Name: <!-- e.g. Solana Mainnet -->
- CAIP-2 ID: <!-- e.g. solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp -->
- Settlement asset(s): <!-- USDC-SPL / SOL / etc -->
- Median settlement: <!-- "~400ms" -->
- Why it matters: <!-- "10M agents on this chain already" / "0 fees" / etc -->

## What's already in the repo

<!-- Check these if true -->

- [ ] Adapter directory exists in `src/adapters/<chain>/`
- [ ] Adapter is in `src/services/routing.service.js` `chainRouter`
- [ ] Adapter is in `src/middleware/x402.middleware.js` `buildChallenge`
- [ ] Real payment has settled end-to-end on this rail (not just stub adapter)

## What needs to happen

<!-- e.g. "USDC-SPL transfer + signature verification" or "wire up existing adapter into challenge builder" -->

## Volunteer to help?

<!-- Y/N — happy to take PRs for chain wiring -->
