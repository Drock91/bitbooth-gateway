# MCP Registry Submission — Step-by-Step

Goal: get `@bitbooth/mcp-fetch` listed on **registry.modelcontextprotocol.io** so any MCP client can discover + auto-install it.

This requires interactive auth from you. ~5 min of clicks.

## Prereqs (you have these)
- ✅ `@bitbooth/mcp-fetch@1.0.0` published to npm
- ✅ `packages/mcp-fetch/server.json` filled out
- ✅ `mcp-publisher.exe` already installed
- ✅ GitHub account `@Drock91`

## Steps

```bash
cd C:/Users/mrhei/Desktop/bitbooth-clean/packages/mcp-fetch

# 1. Log in via GitHub OAuth — opens a browser to authorize
mcp-publisher.exe login github

# 2. Validate server.json against the registry schema
mcp-publisher.exe validate

# 3. Publish (uploads server.json metadata, doesn't republish to npm)
mcp-publisher.exe publish
```

Expected output of step 3:
```
✓ Validated io.github.drock91/bitbooth-fetch@1.0.0
✓ Published to registry.modelcontextprotocol.io
  Discoverable at: https://registry.modelcontextprotocol.io/servers/io.github.drock91/bitbooth-fetch
```

## After it lands

The package will be auto-discoverable in:
- Claude Code's `/mcp` install picker
- Cursor's MCP marketplace
- Continue.dev's tool catalog
- The official `mcp-discovery` CLI

Should appear within ~5 min of publish.

## If something breaks

| Error | Cause | Fix |
|---|---|---|
| `mcpName mismatch` | server.json `name` doesn't start with `io.github.drock91/` | Already correct, shouldn't happen |
| `npm package not found` | Registry can't fetch the npm tarball | `npm whoami` first to confirm logged in, then `npm view @bitbooth/mcp-fetch` to confirm it resolves |
| `validation failed: server.json schema` | Schema URL is stale | Update `$schema` to latest from https://static.modelcontextprotocol.io/schemas/ |
| `not authenticated` | OAuth token expired | Re-run `mcp-publisher.exe login github` |

## Bonus — get featured

After publish, post in:
- https://github.com/modelcontextprotocol/servers/discussions (announce category)
- https://discord.gg/modelcontextprotocol (#new-servers channel)

Keep it 2 sentences:
> Just published @bitbooth/mcp-fetch — pay-per-fetch MCP server using x402 (Coinbase + Linux Foundation spec). Agent's wallet pays $0.005 USDC, gets web content as markdown. Demo: heinrichstech.com/bitbooth.html

That gets you on the "what's new this week" rotation in MCP newsletters.
