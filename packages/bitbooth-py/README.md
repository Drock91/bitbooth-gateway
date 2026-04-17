# bitbooth

Python client for [BitBooth Fetch](https://bitbooth.io/fetch). Pay-per-fetch any
URL and get clean markdown back. Your agent wallet pays **$0.005 USDC on Base**
per fetch via the [x402 protocol](https://x402.org) — no API keys, no
subscriptions, just HTTP `402 Payment Required` answered with an on-chain
transfer.

Works in any Python 3.9+ agent runtime. First-class examples for
[CrewAI](https://www.crewai.com/) and the
[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-python).

## Install

```bash
pip install bitbooth
```

## Quick start

```python
import os
from bitbooth import BitBoothClient

client = BitBoothClient(wallet_key=os.environ["BITBOOTH_AGENT_KEY"])
result = client.fetch("https://news.ycombinator.com/")

print(result["markdown"])
```

The client:

1. `POST`s to `/v1/fetch`.
2. Parses the `402` challenge.
3. Signs and submits a USDC `transfer` on Base via `eth-account` + `web3`.
4. Retries with an `X-PAYMENT` header carrying the tx hash.
5. Returns the JSON body (`markdown`, `url`, `mode`, `bytesScraped`, ...).

## Environment variables

All values may also be passed as keyword args to `BitBoothClient(...)`.

| Variable                 | Default                   | Description                                  |
| ------------------------ | ------------------------- | -------------------------------------------- |
| `BITBOOTH_AGENT_KEY`     | _required_                | Base private key that pays USDC per fetch    |
| `BITBOOTH_API_KEY`       | _optional_                | BitBooth tenant API key (waives rate limits) |
| `BITBOOTH_API_URL`       | `https://api.bitbooth.io` | Gateway URL                                  |
| `BITBOOTH_CHAIN_ID`      | `8453` (Base mainnet)     | Target chain                                 |
| `BITBOOTH_RPC_URL`       | public Base RPC           | Override RPC endpoint                        |
| `BITBOOTH_CONFIRMATIONS` | `2`                       | Confirmations before submitting `X-PAYMENT`  |

## CrewAI integration

Wrap `client.fetch` with a CrewAI `@tool` and hand it to any agent.

```python
import os
from crewai import Agent, Crew, Task
from crewai.tools import tool

from bitbooth import BitBoothClient

client = BitBoothClient(wallet_key=os.environ["BITBOOTH_AGENT_KEY"])


@tool("bitbooth_fetch")
def bitbooth_fetch(url: str) -> str:
    """Fetch a URL and return cleaned markdown. Costs $0.005 USDC on Base."""
    result = client.fetch(url, mode="full")
    return result["markdown"]


researcher = Agent(
    role="Research analyst",
    goal="Summarize frontpage tech news",
    backstory="You read the web for a living.",
    tools=[bitbooth_fetch],
)

task = Task(
    description="Summarize https://news.ycombinator.com/ in five bullet points.",
    expected_output="Markdown list of five headlines with a one-sentence take.",
    agent=researcher,
)

Crew(agents=[researcher], tasks=[task]).kickoff()
```

## Claude Agent SDK integration

Expose `fetch` as a custom tool via the Claude Agent SDK's MCP server helpers.

```python
import os

from bitbooth import BitBoothClient
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    TextBlock,
    create_sdk_mcp_server,
    query,
    tool,
)

client = BitBoothClient(wallet_key=os.environ["BITBOOTH_AGENT_KEY"])


@tool("bitbooth_fetch", "Fetch a URL and return markdown", {"url": str})
async def bitbooth_fetch(args):
    result = client.fetch(args["url"], mode="full")
    return {"content": [{"type": "text", "text": result["markdown"]}]}


server = create_sdk_mcp_server(name="bitbooth", version="1.0.0", tools=[bitbooth_fetch])

options = ClaudeAgentOptions(
    mcp_servers={"bitbooth": server},
    allowed_tools=["mcp__bitbooth__bitbooth_fetch"],
)

async def main():
    async for message in query(
        prompt="Summarize https://news.ycombinator.com/",
        options=options,
    ):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    print(block.text)
```

## Advanced

### Pass a pre-built session or `Web3` instance

Handy for retry policies, custom RPC providers, or offline testing:

```python
import requests
from web3 import Web3

from bitbooth import BitBoothClient

session = requests.Session()
session.headers["User-Agent"] = "my-agent/1.0"

w3 = Web3(Web3.HTTPProvider("https://base.llamarpc.com"))

client = BitBoothClient(
    wallet_key=os.environ["BITBOOTH_AGENT_KEY"],
    session=session,
    web3=w3,
)
```

### Error handling

```python
from bitbooth import BitBoothClient, BitBoothError, PaymentError

try:
    result = client.fetch("https://example.com")
except PaymentError as exc:
    # on-chain payment or post-payment retry failed
    print(f"payment failed: {exc}")
except BitBoothError as exc:
    # 4xx/5xx from the gateway, bad input, unsupported chain, etc.
    print(f"client error: {exc}")
```

## Development

```bash
git clone https://github.com/bitbooth/x402
cd x402/packages/bitbooth-py
pip install -e '.[dev]'
pytest
```

The test suite mocks `requests` and `web3`, so no live RPC is needed.

## How payment works

1. Agent calls `client.fetch(url)`.
2. Client `POST`s to `/v1/fetch`.
3. Gateway responds with `402 Payment Required` + a challenge containing
   `nonce`, `payTo`, `amountWei`, `chainId`.
4. Client transfers `amountWei` USDC to `payTo` on Base, waits for
   confirmations.
5. Client retries the `POST` with `X-PAYMENT: {"nonce","txHash","signature"}`.
6. Gateway verifies the tx on-chain and returns scraped markdown.

Set `BITBOOTH_CHAIN_ID=84532` to run against Base Sepolia (when supported).

## License

MIT © BitBooth
