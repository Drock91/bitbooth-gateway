# @bitbooth/langchain

LangChain tool that fetches any URL and returns clean markdown. Payments are handled automatically via the [x402 protocol](https://bitbooth.io/fetch) — your agent wallet pays **$0.005 USDC on Base** per fetch.

Drops straight into any LangChain JS agent: LangGraph, `createAgent`, `DeepAgents`, or the classic `AgentExecutor`.

## Install

```bash
npm install @bitbooth/langchain @langchain/core
```

## Quick start

```js
import { createAgent } from 'langchain';
import { createBitBoothFetchTool } from '@bitbooth/langchain';

const fetchTool = createBitBoothFetchTool({
  agentKey: process.env.BITBOOTH_AGENT_KEY,
  apiKey: process.env.BITBOOTH_API_KEY,
});

const agent = createAgent({
  model: 'claude-sonnet-4-6',
  tools: [fetchTool],
});

const result = await agent.invoke({
  messages: [{ role: 'user', content: 'Summarize https://news.ycombinator.com/' }],
});

console.log(result);
```

The tool:

- is named `bitbooth_fetch` (override with the `name` option)
- takes `{ url, mode }` where `mode` is `fast` (raw HTML → markdown) or `full` (Readability extraction)
- returns a formatted markdown string with a `_Fetched from …_` footer

## Environment variables

| Variable                 | Default                   | Description                                         |
| ------------------------ | ------------------------- | --------------------------------------------------- |
| `BITBOOTH_AGENT_KEY`     | _required_                | Base private key that pays USDC per fetch           |
| `BITBOOTH_API_KEY`       | _optional_                | BitBooth tenant API key (waives rate limits)        |
| `BITBOOTH_API_URL`       | `https://api.bitbooth.io` | Gateway URL                                         |
| `BITBOOTH_CHAIN_ID`      | `8453` (Base mainnet)     | Target chain                                        |
| `BITBOOTH_RPC_URL`       | public Base RPC           | Override RPC endpoint                               |
| `BITBOOTH_CONFIRMATIONS` | `2`                       | Confirmations to wait before submitting `X-PAYMENT` |

Any of these may also be passed as options to `createBitBoothFetchTool({ ... })`.

## Advanced

### Bring your own x402 client

```js
import { createBitBoothFetchTool, createX402Client } from '@bitbooth/langchain';

const client = createX402Client({ agentKey, apiUrl: 'https://api.bitbooth.io' });
const tool = createBitBoothFetchTool({ client, name: 'scrape_web' });
```

### Use the raw Zod schema

```js
import { BitBoothFetchSchema } from '@bitbooth/langchain';
```

Handy when wiring BitBooth into orchestration frameworks that accept a bare schema + handler (e.g. agent builders, `structuredTool` factories, or MCP bridges).

## How payment works

1. Agent calls `fetchTool.invoke({ url })`.
2. The x402 client `POST`s to `/v1/fetch`.
3. Gateway responds with `402 Payment Required` + a challenge.
4. Client transfers `challenge.amountWei` USDC to `challenge.payTo` on Base.
5. Client retries `POST /v1/fetch` with an `X-PAYMENT` header carrying the tx hash.
6. Gateway verifies on-chain, returns scraped markdown.

Defaults to 2 confirmations on Base mainnet. Set `BITBOOTH_CHAIN_ID=84532` for Base Sepolia testnet (when supported).

## License

MIT © BitBooth
