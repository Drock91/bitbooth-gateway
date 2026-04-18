# 30-Second Smoke Test

If you just installed `@bitbooth/mcp-fetch` and want to confirm everything works **without spending real money**, run this.

## Test 1: Cold-hit the gateway (no install required)

```bash
curl -s -X POST https://app.heinrichstech.com/v1/fetch \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}' | head -c 500
```

**Expected:** A JSON blob starting with `{"error":{"code":"PAYMENT_REQUIRED",...},"challenge":{...}}` — that's the 402 challenge. **If you see this, the gateway is up.** ✅

If you see anything else, [file an issue](https://github.com/Drock91/bitbooth-gateway/issues).

## Test 2: Verify the npm package boots (~10s)

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}' | \
  BITBOOTH_AGENT_KEY=0x0000000000000000000000000000000000000000000000000000000000000001 \
  npx -y @bitbooth/mcp-fetch
```

**Expected:** A line with `bitbooth-fetch MCP server running on stdio` followed by a JSON response with `protocolVersion: "2025-06-18"`. **If you see this, the package boots.** ✅

(The all-zeros agent key is a placeholder — won't work for actual payments, but confirms the server initializes correctly.)

## Test 3: Pay a real testnet fetch (~30s, free)

Need: a Base Sepolia wallet with ~0.01 USDC + ~0.001 ETH.

Faucets:

- ETH for gas: https://www.alchemy.com/faucets/base-sepolia
- USDC: https://faucet.circle.com (select Base Sepolia)

Then:

```bash
git clone https://github.com/Drock91/bitbooth-gateway.git
cd bitbooth-gateway/examples
BITBOOTH_AGENT_KEY=0x<your-base-sepolia-wallet-pk> \
  node 02-node-evm-pay.mjs https://news.ycombinator.com
```

**Expected:** A title + ~500 chars of markdown from Hacker News, then `Done in <ms>ms`. **If you see this, you're production-ready.** ✅

## Common failures + fixes

| Symptom                                | Fix                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `Agent wallet key required`            | Set `BITBOOTH_AGENT_KEY=0x...` (no quotes around the value in shell)      |
| `Wallet 0x... has no ETH for gas`      | Use the Alchemy Base Sepolia faucet                                       |
| `Wallet 0x... has no USDC`             | Use the Circle Base Sepolia faucet                                        |
| `Unexpected HTTP 502`                  | Gateway upstream is down — try again in ~30s, file an issue if persistent |
| `Post-payment fetch failed (HTTP 400)` | Almost always a stale `BITBOOTH_API_URL`. Unset it to use the default     |

## What "production ready" means here

If all 3 tests pass:

- Your install correctly speaks the MCP protocol to any client
- Your wallet correctly signs USDC payments on Base Sepolia
- The gateway correctly verifies your tx and returns content
- You're free to flip `BITBOOTH_CHAIN_ID=8453` and start real-USDC fetches

If you're stuck after Test 3, drop the full output of all three commands in a GitHub issue — that's enough info for someone to debug remotely.
