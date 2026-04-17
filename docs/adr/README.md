# Architecture Decision Records

> Durable decisions only. If a choice can be re-litigated with a file edit in an
> afternoon, it doesn't need an ADR. If it would force a schema migration, a
> re-audit, or a coordinated client-side change, it belongs here.

## Why ADRs

The `x402` gateway accumulates decisions fast — new chains, new rails, new fraud
rules — and the reasoning behind each one lives in commit messages, Slack
threads, and the heads of people who've moved on. ADRs are a small markdown
file per decision, written at the moment we commit, so six months from now a
reader can answer "why is it done this way" without a scavenger hunt.

## Process

1. Copy [`0000-template.md`](./0000-template.md) to `NNNN-short-slug.md` with
   the next unused number (left-pad to 4 digits).
2. Fill in **Context**, **Decision**, **Consequences**. Keep it ≤ 1 page.
3. Open a PR. Reviewers focus on the trade-off capture, not prose polish.
4. Status starts at `proposed`; flips to `accepted` on merge.
5. Superseding an ADR: add `Superseded-by: NNNN` to the header and a one-line
   note in the new ADR's **Context**. Never delete an old ADR.

## Index

| ID   | Status   | Title                                                            |
| ---- | -------- | ---------------------------------------------------------------- |
| 0001 | accepted | [x402 challenge design](./0001-x402-challenge-design.md)         |
| 0002 | accepted | [Multi-exchange quote routing](./0002-multi-exchange-routing.md) |
| 0003 | accepted | [Fraud tally strategy](./0003-fraud-tally-strategy.md)           |

## When to write a new ADR

- A new chain adapter (Solana, XRPL native, new L2).
- A change to the x402 header shape or signature scheme.
- A change to fraud rule mechanics (new window, new tally topology).
- A change to auth, tenant model, or payment settlement guarantees.
- A breaking change to a public endpoint contract.

## When NOT to write one

- Renaming a function. Adding a route. Changing a timeout. Fixing a bug.
- Decisions already captured in `CLAUDE.md` non-negotiables.
