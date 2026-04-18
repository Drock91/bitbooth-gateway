"""BitBooth Fetch Python client implementing the x402 challenge/response flow."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

import requests
from eth_account import Account
from web3 import Web3

from .exceptions import BitBoothError, PaymentError

DEFAULT_API_URL = "https://api.bitbooth.io"
DEFAULT_CONFIRMATIONS = 2
DEFAULT_TIMEOUT = 30
DEFAULT_TX_WAIT_SECONDS = 180
DEFAULT_TX_POLL_SECONDS = 2

USDC_TRANSFER_ABI = [
    {
        "constant": False,
        "inputs": [
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"},
        ],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function",
    }
]

CHAINS: Dict[int, Dict[str, str]] = {
    8453: {
        "name": "Base",
        "rpc_url": "https://mainnet.base.org",
        "usdc_contract": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
}


class BitBoothClient:
    """Pay-per-fetch x402 client.

    Example:
        >>> client = BitBoothClient(os.environ["BITBOOTH_AGENT_KEY"])
        >>> result = client.fetch("https://news.ycombinator.com/")
        >>> print(result["markdown"])
    """

    def __init__(
        self,
        wallet_key: Optional[str] = None,
        *,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None,
        chain_id: Optional[int] = None,
        rpc_url: Optional[str] = None,
        confirmations: Optional[int] = None,
        timeout: Optional[int] = None,
        session: Optional[requests.Session] = None,
        web3: Optional[Web3] = None,
    ) -> None:
        wallet_key = wallet_key or os.environ.get("BITBOOTH_AGENT_KEY")
        if not wallet_key:
            raise BitBoothError(
                "Agent wallet key required. Set BITBOOTH_AGENT_KEY env var or "
                "pass wallet_key.",
            )

        self._account = Account.from_key(wallet_key)

        resolved_api_url = (
            api_url or os.environ.get("BITBOOTH_API_URL") or DEFAULT_API_URL
        ).rstrip("/")
        self._api_url = resolved_api_url
        self._api_key = api_key or os.environ.get("BITBOOTH_API_KEY")

        resolved_chain_id = int(
            chain_id or os.environ.get("BITBOOTH_CHAIN_ID") or 8453
        )
        if resolved_chain_id not in CHAINS:
            raise BitBoothError(
                f"Unsupported chain ID: {resolved_chain_id}. "
                f"Supported: {sorted(CHAINS.keys())}",
            )
        chain = CHAINS[resolved_chain_id]
        self._chain_id = resolved_chain_id

        resolved_rpc = (
            rpc_url or os.environ.get("BITBOOTH_RPC_URL") or chain["rpc_url"]
        )
        self._web3 = web3 or Web3(Web3.HTTPProvider(resolved_rpc))

        self._confirmations = int(
            confirmations
            or os.environ.get("BITBOOTH_CONFIRMATIONS")
            or DEFAULT_CONFIRMATIONS
        )
        self._timeout = int(timeout or DEFAULT_TIMEOUT)
        self._session = session or requests.Session()

        self._usdc_address = Web3.to_checksum_address(chain["usdc_contract"])
        self._usdc = self._web3.eth.contract(
            address=self._usdc_address,
            abi=USDC_TRANSFER_ABI,
        )

    @property
    def address(self) -> str:
        """The 0x address derived from the configured agent wallet."""
        return self._account.address

    def fetch(self, url: str, mode: str = "fast") -> Dict[str, Any]:
        """Fetch ``url`` via BitBooth Fetch, paying on-chain if a 402 is returned.

        Args:
            url: Absolute URL to fetch. Must include scheme.
            mode: ``"fast"`` (raw HTML → markdown) or ``"full"``
                (Readability-based extraction + cleaner markdown).

        Returns:
            Parsed JSON response body from ``POST /v1/fetch`` on success.

        Raises:
            BitBoothError: If the gateway responds with an unexpected status.
            PaymentError: If the 402 challenge is malformed or the on-chain
                payment fails or the post-payment retry does not return 200.
        """
        if mode not in ("fast", "full"):
            raise BitBoothError(f"Invalid mode: {mode!r}. Use 'fast' or 'full'.")

        body = {"url": url, "mode": mode}
        headers = {"content-type": "application/json"}
        if self._api_key:
            headers["x-api-key"] = self._api_key

        first = self._session.post(
            f"{self._api_url}/v1/fetch",
            json=body,
            headers=headers,
            timeout=self._timeout,
        )

        if first.status_code == 200:
            return first.json()

        if first.status_code != 402:
            raise BitBoothError(
                f"Unexpected HTTP {first.status_code}: {_preview(first)}",
            )

        challenge = _extract_challenge(first)
        tx_hash = self._pay(challenge)

        x_payment = json.dumps(
            {
                "nonce": challenge["nonce"],
                "txHash": tx_hash,
                "signature": "bitbooth-py",
            }
        )
        retry_headers = {**headers, "x-payment": x_payment}

        second = self._session.post(
            f"{self._api_url}/v1/fetch",
            json=body,
            headers=retry_headers,
            timeout=self._timeout,
        )

        if second.status_code != 200:
            raise PaymentError(
                f"Post-payment fetch failed (HTTP {second.status_code}): "
                f"{_preview(second)}",
            )

        return second.json()

    def _pay(self, challenge: Dict[str, Any]) -> str:
        """Submit a USDC transfer satisfying the challenge, return tx hash hex."""
        pay_to = Web3.to_checksum_address(challenge["payTo"])
        amount = int(challenge["amountWei"])

        tx_nonce = self._web3.eth.get_transaction_count(self._account.address)
        gas_price = self._web3.eth.gas_price
        priority = self._web3.to_wei(1, "gwei")
        transfer = self._usdc.functions.transfer(pay_to, amount)
        tx = transfer.build_transaction(
            {
                "from": self._account.address,
                "chainId": self._chain_id,
                "nonce": tx_nonce,
                "gas": 100_000,
                "maxFeePerGas": gas_price + priority,
                "maxPriorityFeePerGas": priority,
            }
        )

        signed = self._account.sign_transaction(tx)
        raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
        tx_hash_bytes = self._web3.eth.send_raw_transaction(raw)
        receipt = self._web3.eth.wait_for_transaction_receipt(
            tx_hash_bytes,
            timeout=DEFAULT_TX_WAIT_SECONDS,
            poll_latency=DEFAULT_TX_POLL_SECONDS,
        )
        if receipt.status != 1:
            raise PaymentError(f"Payment tx reverted: {_hex(tx_hash_bytes)}")
        return _hex(tx_hash_bytes)


def _preview(response: requests.Response) -> str:
    try:
        return response.text[:500]
    except Exception:
        return "<no body>"


def _extract_challenge(response: requests.Response) -> Dict[str, Any]:
    try:
        payload = response.json() or {}
    except ValueError as exc:
        raise PaymentError(f"402 response was not JSON: {exc}") from exc

    challenge = payload.get("challenge") or payload
    nonce = challenge.get("nonce") if isinstance(challenge, dict) else None
    if not nonce:
        raise PaymentError("402 response missing challenge.nonce")
    if not challenge.get("payTo"):
        raise PaymentError("402 response missing challenge.payTo")
    if challenge.get("amountWei") is None:
        raise PaymentError("402 response missing challenge.amountWei")
    return challenge


def _hex(value: Any) -> str:
    if isinstance(value, (bytes, bytearray)):
        return "0x" + bytes(value).hex()
    if hasattr(value, "hex"):
        result = value.hex()
        return result if result.startswith("0x") else "0x" + result
    return str(value)
