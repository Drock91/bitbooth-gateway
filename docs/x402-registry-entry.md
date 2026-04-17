---
status: draft
registry: coinbase-x402-tools
submitted_by: BitBooth
submitted_by_email: hello@bitbooth.io
prepared_at: 2026-04-16
goal: G-224
---

# BitBooth Fetch — x402 Tool Registry Entry

> Living draft for the Coinbase x402 tool registry submission. This file is
> the canonical pre-draft so that the moment the registry opens for
> submissions, we paste (or PR) the YAML entry below verbatim.

## Submission metadata

| Field                | Value                                            |
| -------------------- | ------------------------------------------------ |
| Tool name            | BitBooth Fetch                                   |
| Vendor               | BitBooth                                         |
| Homepage             | https://bitbooth.io/fetch                        |
| Contact email        | hello@bitbooth.io                                |
| Primary maintainer   | D-rock (BitBooth)                                |
| x402 version         | 0.1 (Coinbase draft spec, multi-chain `accepts`) |
| License              | Commercial (usage metered per call)              |
| Source (OSS clients) | https://github.com/bitbooth/x402                 |

## Short description (one sentence, ≤160 chars)

Pay-per-scrape for AI agents. One HTTP call returns clean markdown from any
URL. Agents pay $0.005 in USDC on Base, Solana, or XRPL — no API keys.

## Long description

BitBooth Fetch turns any URL into a single paid HTTP call. An agent POSTs a
URL, receives an HTTP 402 challenge with a multi-chain `accepts` array, pays
$0.005 USDC on the rail of its choice (Base L2, Solana, or the XRP Ledger),
and gets back structured markdown (title + body + metadata) produced with
Mozilla Readability and Turndown.

Designed for agent frameworks: no browser farm, no proxy rotation, no parsing
pipeline on the agent side. Integration is three lines of code in any x402
client (including Coinbase's reference client). First-class SDKs ship for
Node.js (`@bitbooth/langchain`, `@bitbooth/mcp-fetch`) and Python
(`pip install bitbooth`), plus a vanilla Claude Desktop / Claude Code MCP
server that most users install in one command.

## Pricing

| Endpoint                  | Price per call       | Asset | Networks                                                     |
| ------------------------- | -------------------- | ----- | ------------------------------------------------------------ |
| POST /v1/fetch            | $0.005               | USDC  | Base (eip155:8453), Solana (solana:mainnet), XRPL (xrpl:0/1) |
| POST /v1/resource         | $0.01                | USDC  | Base (eip155:8453), Solana (solana:mainnet), XRPL (xrpl:0/1) |
| POST /v1/resource/premium | $0.02                | USDC  | Base (eip155:8453), Solana (solana:mainnet), XRPL (xrpl:0/1) |
| POST /v1/resource/bulk    | $0.01 × N (max N=10) | USDC  | Base (eip155:8453), Solana (solana:mainnet), XRPL (xrpl:0/1) |

Prices are quoted in USDC micro-units (6 decimals) in the 402 `amount` field.
`$0.005 = 5000` USDC micro-units.

## Network support

- **Base mainnet** (`eip155:8453`) — USDC at `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **Base Sepolia** (`eip155:84532`) — staging, already settling real tx
- **Solana mainnet** (`solana:<mint>`) — USDC SPL
- **XRPL mainnet** (`xrpl:0`) and testnet (`xrpl:1`) — XRP or Circle's XRPL-native USDC IOU

## API endpoint

Production (mainnet, Q2 2026): `https://api.bitbooth.io/v1/fetch`
Staging (Base Sepolia, live today): `https://x76se73jxd.execute-api.us-east-2.amazonaws.com/staging/v1/fetch`

## Example request

```http
POST /v1/fetch HTTP/1.1
Host: api.bitbooth.io
Content-Type: application/json

{ "url": "https://example.com", "mode": "fast" }
```

### Initial 402 response

```json
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": "0.1",
  "error": "payment-required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "payTo": "0x6Eb83C70a71c81BE7Fc13F0d711A28736a9E37Fc",
      "asset": "USDC@0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "5000"
    },
    {
      "scheme": "exact",
      "network": "solana:mainnet",
      "payTo": "<solana-treasury>",
      "asset": "USDC@<usdc-mint>",
      "amount": "5000"
    },
    {
      "scheme": "exact",
      "network": "xrpl:0",
      "payTo": "<xrpl-address>",
      "asset": "USDC@<circle-xrpl-issuer>",
      "amount": "5000"
    }
  ],
  "nonce": "6f21…",
  "expiresAt": 1744816920,
  "resource": "/v1/fetch"
}
```

### Retry with X-Payment header

```http
POST /v1/fetch HTTP/1.1
Host: api.bitbooth.io
Content-Type: application/json
X-Payment: base64(<CAIP-2 scheme>://<txHash>/<nonce>)

{ "url": "https://example.com", "mode": "fast" }
```

### Success response

```json
HTTP/1.1 200 OK
Content-Type: application/json
X-Payment-Verified: true

{
  "title": "Example Domain",
  "markdown": "# Example Domain\n\nThis domain is for use in illustrative examples...",
  "metadata": {
    "url": "https://example.com",
    "fetchedAt": "2026-04-16T12:00:00Z",
    "contentLength": 1423,
    "truncated": false
  }
}
```

## Client quick-start snippets

```javascript
// @bitbooth/langchain — LangChain tool
import { createBitBoothFetchTool } from '@bitbooth/langchain';
const fetchTool = createBitBoothFetchTool({ agentKey: process.env.BITBOOTH_AGENT_KEY });
const result = await fetchTool.invoke({ url: 'https://example.com' });
```

```python
# bitbooth-py — Python client (CrewAI / Claude Agent SDK friendly)
from bitbooth import BitBoothClient
client = BitBoothClient(agent_key=os.environ["BITBOOTH_AGENT_KEY"])
res = client.fetch("https://example.com")
print(res.markdown)
```

```jsonc
// Claude Desktop claude_desktop_config.json
{
  "mcpServers": {
    "bitbooth-fetch": {
      "command": "npx",
      "args": ["-y", "@bitbooth/mcp-fetch"],
      "env": { "BITBOOTH_AGENT_KEY": "0x..." },
    },
  },
}
```

## Registry YAML (canonical submission)

> Format guessed from similar x402 ecosystem registries (CAIP-2 networks, OWS
> tool schema). Adjust to match the final Coinbase schema when published.

```yaml
name: bitbooth-fetch
vendor: BitBooth
description: Pay-per-scrape for AI agents. Returns clean markdown for any URL.
homepage: https://bitbooth.io/fetch
docs: https://bitbooth.io/docs
contact: hello@bitbooth.io
license: commercial
x402:
  version: '0.1'
  endpoints:
    - method: POST
      path: /v1/fetch
      price_usd: 0.005
      networks: [eip155:8453, eip155:84532, solana:mainnet, xrpl:0, xrpl:1]
      asset: USDC
    - method: POST
      path: /v1/resource
      price_usd: 0.01
      networks: [eip155:8453, solana:mainnet, xrpl:0]
      asset: USDC
    - method: POST
      path: /v1/resource/premium
      price_usd: 0.02
      networks: [eip155:8453, solana:mainnet, xrpl:0]
      asset: USDC
clients:
  - runtime: node
    package: '@bitbooth/langchain'
    registry: npm
  - runtime: node
    package: '@bitbooth/mcp-fetch'
    registry: npm
  - runtime: python
    package: bitbooth
    registry: pypi
tags: [fetch, scrape, markdown, mcp, langchain, crewai]
```

## Discord post (x402 #showcase)

> Post verbatim once the registry announcement lands. Tag Kevin Leffew if
> appropriate and the community norms encourage it.

```
👋 Hi x402 community — shipped the first end-to-end 402 tool aimed at AI agents:

**BitBooth Fetch** — pay $0.005 USDC per URL and get back clean markdown.
One HTTP call, no scraping infra. Multi-chain 402 accepts out of the box
(Base, Solana, XRPL).

• Node client: `npm i @bitbooth/langchain`
• MCP server: `npx -y @bitbooth/mcp-fetch` (Claude Desktop + Claude Code)
• Python: `pip install bitbooth`
• Staging (live, Base Sepolia): https://x76se73jxd.execute-api.us-east-2.amazonaws.com/staging/v1/fetch
• Docs + live demo: https://bitbooth.io/fetch

Would love to be listed in the x402 tool registry when it opens — full draft
entry is at github.com/bitbooth/x402/blob/main/docs/x402-registry-entry.md.
Happy to be a reference implementation / case study if useful.

— D-rock, BitBooth
```

## Submission checklist

- [ ] Coinbase x402 registry URL announced and submission format finalized
- [ ] Paste/PR the Registry YAML section into the official registry repo
- [ ] Post the Discord #showcase message above
- [ ] DM Kevin Leffew (see docs/GO-TO-MARKET.md Kevin Leffew section)
- [ ] Update docs/GO-TO-MARKET.md Phase 2 row (G-224) to `DONE` with link to
      the merged registry entry
- [ ] Bump NORTH_STAR — add `x402_registry_listed: true` once live

## Change log

- 2026-04-16 — Initial draft (G-224). Registry still not open for public
  submissions; this file is the pre-drafted submission so we can ship the
  moment it opens.
