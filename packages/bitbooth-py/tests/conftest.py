"""Shared pytest fixtures for the bitbooth test suite."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest


TEST_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001"


@pytest.fixture(autouse=True)
def clear_env(monkeypatch):
    """Clear BitBooth env vars so tests don't leak real config."""
    for name in (
        "BITBOOTH_AGENT_KEY",
        "BITBOOTH_API_KEY",
        "BITBOOTH_API_URL",
        "BITBOOTH_CHAIN_ID",
        "BITBOOTH_RPC_URL",
        "BITBOOTH_CONFIRMATIONS",
    ):
        monkeypatch.delenv(name, raising=False)


def _response(status_code=200, json_body=None, text=""):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_body or {}
    resp.text = text
    return resp


@pytest.fixture
def make_response():
    return _response


@pytest.fixture
def session_mock():
    session = MagicMock()
    session.post = MagicMock()
    return session


@pytest.fixture
def web3_mock():
    """A MagicMock stand-in for a Web3 instance wired for USDC transfers."""
    receipt = MagicMock()
    receipt.status = 1

    contract = MagicMock()
    transfer_call = MagicMock()
    transfer_call.build_transaction.return_value = {
        "from": "0x0",
        "chainId": 8453,
        "nonce": 0,
        "gas": 100_000,
        "maxFeePerGas": 2_000_000_000,
        "maxPriorityFeePerGas": 1_000_000_000,
        "to": "0xUSDC",
        "data": "0x",
    }
    contract.functions.transfer.return_value = transfer_call

    w3 = MagicMock()
    w3.eth.contract.return_value = contract
    w3.eth.get_transaction_count.return_value = 0
    w3.eth.gas_price = 1_000_000_000
    w3.eth.send_raw_transaction.return_value = bytes.fromhex("ab" * 32)
    w3.eth.wait_for_transaction_receipt.return_value = receipt
    w3.to_wei.return_value = 1_000_000_000
    return w3
