# @bitbooth/mcp-fetch

[![npm version](https://img.shields.io/npm/v/@bitbooth/mcp-fetch.svg)](https://www.npmjs.com/package/@bitbooth/mcp-fetch)
[![MIT license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

MCP server that fetches any URL and returns clean markdown. Payments handled automatically via the [x402 protocol](https://github.com/Drock91/bitbooth-gateway) — your agent wallet pays **$0.005 per fetch**.

**Zero signup. No API keys. No accounts.** The agent's wallet pays per call.

> ✅ **Verified end-to-end on live mainnet** — last real payment landed in 1.3s ([proof](https://xrpscan.com/tx/493F6F1ADB9D258898A028F1D0A34684F5DD8B8C9F99BC6FB3432EA1F8AA45C0)).
>
> 🛡️ **Testnet by default.** Defaults to Base Sepolia so a fresh install spends free testnet USDC, not real money. Opt into mainnet explicitly (see below).

## Install

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bitbooth-fetch": {
      "command": "npx",
      "args": ["-y", "@bitbooth/mcp-fetch"],
      "env": {
        "BITBOOTH_AGENT_KEY": "0x<your-testnet-wallet-private-key>"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add bitbooth-fetch -- npx -y @bitbooth/mcp-fetch
```

Set your agent wallet key:

```bash
export BITBOOTH_AGENT_KEY="0x<your-testnet-wallet-private-key>"
```

### Global install

```bash
npm install -g @bitbooth/mcp-fetch
mcp-fetch   # runs on stdio
```

## Get a testnet wallet + USDC (free, 2 minutes)

1. Generate an EVM wallet or use an existing one you control
2. Fund it with Base Sepolia ETH (gas): https://www.alchemy.com/faucets/base-sepolia
3. Fund it with Base Sepolia USDC: https://faucet.circle.com (select Base Sepolia)
4. Set `BITBOOTH_AGENT_KEY` to the wallet's private key (`0x...`)

## Usage

Once installed, your agent gets a `fetch` tool:

```
fetch(url: "https://example.com", mode: "fast")
```

**Modes:**

| Mode   | Description                      | Best for         |
| ------ | -------------------------------- | ---------------- |
| `fast` | Raw HTML converted to markdown   | Quick lookups    |
| `full` | Article extraction then markdown | Blog posts, docs |

Returns markdown with title, body, and metadata (URL, timestamp, content length, truncation status).

## Pricing

| Item       | Cost                                              |
| ---------- | ------------------------------------------------- |
| Per fetch  | **0.005 USDC** (testnet: free Circle Sepolia USDC) |
| Gas        | ~$0.0001 per tx on Base (mainnet) / free (testnet) |
| Default chain | Base Sepolia (testnet). Explicit opt-in for mainnet. |

## Configuration

| Env var                  | Description                                              | Default |
| ------------------------ | -------------------------------------------------------- | ------- |
| `BITBOOTH_AGENT_KEY`     | Agent wallet private key **(required, 0x-prefixed hex)** | — |
| `BITBOOTH_CHAIN_ID`      | `84532` = Base Sepolia (default, free testnet). `8453` = Base mainnet (real USDC — opt-in). | `84532` |
| `BITBOOTH_API_URL`       | BitBooth gateway URL                                     | staging endpoint (Base Sepolia) |
| `BITBOOTH_RPC_URL`       | EVM RPC endpoint                                         | `https://base-sepolia-rpc.publicnode.com` |
| `BITBOOTH_CONFIRMATIONS` | Tx confirmations to wait before retry                    | `1` |
| `BITBOOTH_API_KEY`       | Optional tenant API key (for higher rate limits)         | — |

## Mainnet opt-in

When you've tested against Sepolia and want to run against real Base mainnet:

```bash
export BITBOOTH_CHAIN_ID=8453
export BITBOOTH_API_URL=https://app.heinrichstech.com
export BITBOOTH_RPC_URL=https://base-rpc.publicnode.com   # or your own RPC
export BITBOOTH_AGENT_KEY=0x<mainnet-wallet-with-real-USDC>
```

The package prints a warning banner to stderr whenever mainnet is active so a misconfig can't silently drain a real wallet.

> The same `app.heinrichstech.com` gateway also accepts XRPL Mainnet payments (XRP, USDC-via-Bitstamp, RLUSD-via-Ripple). Native XRPL support in this MCP package is on the roadmap — track it at https://github.com/Drock91/bitbooth-gateway/issues

## Programmatic use

```js
import { createX402Client } from '@bitbooth/mcp-fetch/x402-client';

const client = createX402Client({ agentKey: process.env.AGENT_KEY });
const result = await client.fetchWithPayment('https://example.com', 'fast');
console.log(result.markdown);
```

## How it works

1. Your agent calls `fetch(url)` via MCP
2. The server `POST /v1/fetch`s to BitBooth
3. BitBooth returns **HTTP 402** with a payment challenge `{ nonce, payTo, amountWei }`
4. The server transfers USDC on Base to `payTo`
5. Waits for 1 confirmation, retries with the `x-payment` header
6. Returns the fetched content as markdown

Zero human in the loop. Zero signup. Just pay-per-call via x402.

## Security notes

- `BITBOOTH_AGENT_KEY` is a private key — treat it like a password. Use a dedicated wallet for this agent, not your personal wallet.
- Default config uses **testnet**. Never set mainnet keys in a testnet config.
- The package makes an outbound payment transaction to the BitBooth payTo address on every successful fetch. If the service is unavailable, the retry request fails but the payment was still sent on-chain — refunds require contacting the operator.

## License

MIT
