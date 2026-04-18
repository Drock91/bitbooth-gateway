# BitBooth Examples

Runnable code samples for the most common BitBooth use cases. Each example is **single-file, copy-pasteable, and verified to work against the live staging gateway** at `https://app.heinrichstech.com`.

| Example                                            | What it shows                               | Real money?             |
| -------------------------------------------------- | ------------------------------------------- | ----------------------- |
| [`01-curl-fetch.sh`](./01-curl-fetch.sh)           | Bare curl walkthrough of the x402 flow      | No (just shows the 402) |
| [`02-node-evm-pay.mjs`](./02-node-evm-pay.mjs)     | Pay USDC on Base Sepolia from Node.js       | Free testnet USDC       |
| [`03-node-xrpl-pay.mjs`](./03-node-xrpl-pay.mjs)   | Pay XRP on XRPL Mainnet from Node.js        | Real XRP (~$0.003)      |
| [`04-mcp-config.json`](./04-mcp-config.json)       | Drop-in MCP config for Claude Code / Cursor | Free testnet            |
| [`05-langchain-agent.py`](./05-langchain-agent.py) | LangChain agent that pays per call          | Free testnet            |

## Common prereqs

- Node 20+ for Node examples
- `curl` for shell examples
- For paid examples: a wallet with funds on the relevant chain (faucets linked in each file)

## Help

If an example breaks, file an issue with the output: https://github.com/Drock91/bitbooth-gateway/issues
