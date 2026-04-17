---
'@bitbooth/mcp-fetch': patch
---

v1.0.1 — polish for the public launch:

- Default `BITBOOTH_API_URL` switched from raw API GW URL to `https://app.heinrichstech.com` (cleaner, more shareable, same backend)
- Mainnet opt-in section in README now ships with the actual production URL instead of "ask the maintainer"
- ethers errors translated into actionable messages — agents now see "Wallet 0x... has no USDC, faucet here" instead of `execution reverted` stack traces
- Expanded npm `keywords` for SEO (claude-code, cursor, windsurf, continue-dev, xrpl, ai-tools, etc.)
- Description rewritten to mention XRPL Mainnet support on the gateway (mcp-fetch itself is still EVM-only; XRPL signing on the roadmap)
- README badges (npm version, MIT) + a "verified end-to-end on mainnet" callout linking to a real tx
