#!/usr/bin/env python3
"""
05 — LangChain agent that uses BitBooth as a paid tool

This wraps the /v1/fetch endpoint as a LangChain Tool. The agent decides when
to call it; the wallet pays per call.

Cost:    Free (testnet defaults). Get USDC from https://faucet.circle.com
         (Base Sepolia) and gas ETH from https://www.alchemy.com/faucets/base-sepolia

Install: pip install langchain langchain-openai eth-account web3 requests

Run:     OPENAI_API_KEY=sk-... AGENT_KEY=0x... python 05-langchain-agent.py

Note: This example uses raw web3.py for the on-chain payment. The
@bitbooth/bitbooth-py package (in packages/bitbooth-py) wraps this in
a one-liner — use it once it's published to PyPI.
"""

import json
import os
import requests
from eth_account import Account
from web3 import Web3

API = os.environ.get("BITBOOTH_API_URL", "https://app.heinrichstech.com")
CHAIN_ID = 84532  # Base Sepolia
USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
RPC_URL = "https://base-sepolia-rpc.publicnode.com"

USDC_ABI = [
    {
        "constant": False,
        "inputs": [
            {"name": "_to", "type": "address"},
            {"name": "_value", "type": "uint256"},
        ],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function",
    }
]

w3 = Web3(Web3.HTTPProvider(RPC_URL))
account = Account.from_key(os.environ["AGENT_KEY"])
usdc = w3.eth.contract(address=USDC_ADDRESS, abi=USDC_ABI)


def bitbooth_fetch(url: str, mode: str = "fast") -> str:
    """LangChain-friendly tool: pay-per-fetch a URL, return markdown."""
    r1 = requests.post(
        f"{API}/v1/fetch",
        json={"url": url, "mode": mode},
        timeout=30,
    )
    if r1.status_code == 200:
        return r1.json()["markdown"]

    if r1.status_code != 402:
        raise RuntimeError(f"Unexpected HTTP {r1.status_code}: {r1.text[:200]}")

    challenge = r1.json()["challenge"]
    evm_accept = next(
        (a for a in challenge["accepts"] if a["network"] == f"eip155:{CHAIN_ID}"), None
    )
    if not evm_accept:
        raise RuntimeError("Server didn't advertise our chain")

    tx = usdc.functions.transfer(evm_accept["payTo"], int(evm_accept["amount"])).build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "gas": 100_000,
        "maxFeePerGas": w3.to_wei(0.1, "gwei"),
        "maxPriorityFeePerGas": w3.to_wei(0.01, "gwei"),
        "chainId": CHAIN_ID,
    })
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction).hex()
    w3.eth.wait_for_transaction_receipt(tx_hash)

    x_payment = json.dumps({
        "nonce": challenge["nonce"],
        "txHash": tx_hash if tx_hash.startswith("0x") else f"0x{tx_hash}",
        "network": f"eip155:{CHAIN_ID}",
        "signature": "x402-evm-v1",
    })
    r2 = requests.post(
        f"{API}/v1/fetch",
        json={"url": url, "mode": mode},
        headers={"x-payment": x_payment},
        timeout=30,
    )
    r2.raise_for_status()
    return r2.json()["markdown"]


# --- LangChain integration starts here ---
if __name__ == "__main__":
    try:
        from langchain.agents import Tool, AgentType, initialize_agent
        from langchain_openai import ChatOpenAI
    except ImportError:
        print("pip install langchain langchain-openai")
        raise

    fetch_tool = Tool(
        name="bitbooth_fetch",
        description=(
            "Fetch a URL and return its content as markdown. "
            "Costs $0.005 USDC per call paid from the agent wallet."
        ),
        func=lambda url: bitbooth_fetch(url, mode="fast"),
    )

    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    agent = initialize_agent(
        tools=[fetch_tool],
        llm=llm,
        agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION,
        verbose=True,
    )

    answer = agent.invoke(
        "What's on https://news.ycombinator.com right now? Summarize the top 3 headlines."
    )
    print("\n=== AGENT ANSWER ===")
    print(answer["output"])
