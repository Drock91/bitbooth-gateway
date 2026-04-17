"""Unit tests for bitbooth.BitBoothClient."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from bitbooth import BitBoothClient, BitBoothError, PaymentError, __version__
from bitbooth.client import CHAINS, _extract_challenge, _hex, _preview


TEST_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001"
TEST_ADDRESS = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"


def make_challenge(**overrides):
    base = {
        "nonce": "nonce-abc",
        "payTo": "0x1234567890123456789012345678901234567890",
        "amountWei": "5000",
        "resource": "https://example.com/resource",
        "chainId": 8453,
        "expiresAt": 9_999_999_999,
        "accepts": [],
    }
    base.update(overrides)
    return base


def response(status_code=200, json_body=None, text=""):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_body if json_body is not None else {}
    resp.text = text
    return resp


def build_client(session_mock, web3_mock, **opts):
    return BitBoothClient(
        wallet_key=opts.pop("wallet_key", TEST_KEY),
        session=session_mock,
        web3=web3_mock,
        **opts,
    )


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestConstruction:
    def test_requires_wallet_key(self, session_mock, web3_mock):
        with pytest.raises(BitBoothError, match="Agent wallet key required"):
            BitBoothClient(session=session_mock, web3=web3_mock)

    def test_reads_wallet_key_from_env(self, monkeypatch, session_mock, web3_mock):
        monkeypatch.setenv("BITBOOTH_AGENT_KEY", TEST_KEY)
        client = BitBoothClient(session=session_mock, web3=web3_mock)
        assert client.address == TEST_ADDRESS

    def test_rejects_unsupported_chain(self, session_mock, web3_mock):
        with pytest.raises(BitBoothError, match="Unsupported chain ID: 9999"):
            BitBoothClient(
                wallet_key=TEST_KEY,
                chain_id=9999,
                session=session_mock,
                web3=web3_mock,
            )

    def test_reads_chain_from_env(self, monkeypatch, session_mock, web3_mock):
        monkeypatch.setenv("BITBOOTH_CHAIN_ID", "8453")
        client = build_client(session_mock, web3_mock)
        assert client._chain_id == 8453

    def test_api_url_default_stripped(self, session_mock, web3_mock):
        client = build_client(session_mock, web3_mock, api_url="https://x/")
        assert client._api_url == "https://x"

    def test_api_url_from_env(self, monkeypatch, session_mock, web3_mock):
        monkeypatch.setenv("BITBOOTH_API_URL", "https://custom.example.com/")
        client = build_client(session_mock, web3_mock)
        assert client._api_url == "https://custom.example.com"

    def test_api_key_from_env(self, monkeypatch, session_mock, web3_mock):
        monkeypatch.setenv("BITBOOTH_API_KEY", "sk_test_123")
        client = build_client(session_mock, web3_mock)
        assert client._api_key == "sk_test_123"

    def test_confirmations_from_env(self, monkeypatch, session_mock, web3_mock):
        monkeypatch.setenv("BITBOOTH_CONFIRMATIONS", "5")
        client = build_client(session_mock, web3_mock)
        assert client._confirmations == 5

    def test_address_matches_known_key(self, session_mock, web3_mock):
        client = build_client(session_mock, web3_mock)
        assert client.address == TEST_ADDRESS

    def test_exposes_chain_registry(self):
        assert 8453 in CHAINS
        assert CHAINS[8453]["name"] == "Base"

    def test_version_string(self):
        assert isinstance(__version__, str) and __version__


# ---------------------------------------------------------------------------
# fetch() — happy paths
# ---------------------------------------------------------------------------


class TestFetchHappyPath:
    def test_returns_200_without_payment(self, session_mock, web3_mock):
        session_mock.post.return_value = response(
            200, {"markdown": "# hi", "url": "https://e.com"}
        )
        client = build_client(session_mock, web3_mock)

        result = client.fetch("https://e.com")
        assert result == {"markdown": "# hi", "url": "https://e.com"}
        assert session_mock.post.call_count == 1

    def test_sends_api_key_header_when_configured(self, session_mock, web3_mock):
        session_mock.post.return_value = response(200, {"ok": True})
        client = build_client(session_mock, web3_mock, api_key="sk_live_xyz")

        client.fetch("https://e.com")
        _, kwargs = session_mock.post.call_args
        assert kwargs["headers"]["x-api-key"] == "sk_live_xyz"

    def test_fast_mode_is_default(self, session_mock, web3_mock):
        session_mock.post.return_value = response(200, {"ok": True})
        client = build_client(session_mock, web3_mock)

        client.fetch("https://e.com")
        _, kwargs = session_mock.post.call_args
        assert kwargs["json"]["mode"] == "fast"

    def test_full_mode_is_forwarded(self, session_mock, web3_mock):
        session_mock.post.return_value = response(200, {"ok": True})
        client = build_client(session_mock, web3_mock)

        client.fetch("https://e.com", mode="full")
        _, kwargs = session_mock.post.call_args
        assert kwargs["json"]["mode"] == "full"


# ---------------------------------------------------------------------------
# fetch() — input validation
# ---------------------------------------------------------------------------


class TestFetchValidation:
    def test_rejects_invalid_mode(self, session_mock, web3_mock):
        client = build_client(session_mock, web3_mock)
        with pytest.raises(BitBoothError, match="Invalid mode"):
            client.fetch("https://e.com", mode="turbo")

    def test_unexpected_status_raises_bitbooth_error(self, session_mock, web3_mock):
        session_mock.post.return_value = response(500, {}, text="boom")
        client = build_client(session_mock, web3_mock)
        with pytest.raises(BitBoothError, match="Unexpected HTTP 500"):
            client.fetch("https://e.com")


# ---------------------------------------------------------------------------
# fetch() — 402 challenge flow
# ---------------------------------------------------------------------------


class TestChallengeFlow:
    def test_pays_and_retries_on_402(self, session_mock, web3_mock):
        challenge = make_challenge()
        session_mock.post.side_effect = [
            response(402, {"challenge": challenge}),
            response(200, {"markdown": "# paid"}),
        ]
        client = build_client(session_mock, web3_mock)

        result = client.fetch("https://e.com")

        assert result == {"markdown": "# paid"}
        assert session_mock.post.call_count == 2
        web3_mock.eth.send_raw_transaction.assert_called_once()

    def test_retry_carries_x_payment_header(self, session_mock, web3_mock):
        challenge = make_challenge()
        session_mock.post.side_effect = [
            response(402, {"challenge": challenge}),
            response(200, {"ok": True}),
        ]
        client = build_client(session_mock, web3_mock)

        client.fetch("https://e.com")

        second_headers = session_mock.post.call_args_list[1].kwargs["headers"]
        assert "x-payment" in second_headers
        x_payment = json.loads(second_headers["x-payment"])
        assert x_payment["nonce"] == challenge["nonce"]
        assert x_payment["txHash"].startswith("0x")
        assert x_payment["signature"] == "bitbooth-py"

    def test_builds_transfer_with_challenge_values(self, session_mock, web3_mock):
        challenge = make_challenge(amountWei="7777", payTo="0xaaaa000000000000000000000000000000000000")
        session_mock.post.side_effect = [
            response(402, {"challenge": challenge}),
            response(200, {"ok": True}),
        ]
        client = build_client(session_mock, web3_mock)

        client.fetch("https://e.com")

        transfer = web3_mock.eth.contract.return_value.functions.transfer
        args, _ = transfer.call_args
        assert args[0].lower() == challenge["payTo"].lower()
        assert args[1] == 7777

    def test_challenge_without_nonce_raises_payment_error(
        self, session_mock, web3_mock
    ):
        bad = make_challenge()
        bad.pop("nonce")
        session_mock.post.return_value = response(402, {"challenge": bad})
        client = build_client(session_mock, web3_mock)

        with pytest.raises(PaymentError, match="missing challenge.nonce"):
            client.fetch("https://e.com")

    def test_challenge_without_payto_raises_payment_error(
        self, session_mock, web3_mock
    ):
        bad = make_challenge()
        bad.pop("payTo")
        session_mock.post.return_value = response(402, {"challenge": bad})
        client = build_client(session_mock, web3_mock)

        with pytest.raises(PaymentError, match="payTo"):
            client.fetch("https://e.com")

    def test_challenge_without_amount_raises_payment_error(
        self, session_mock, web3_mock
    ):
        bad = make_challenge()
        bad.pop("amountWei")
        session_mock.post.return_value = response(402, {"challenge": bad})
        client = build_client(session_mock, web3_mock)

        with pytest.raises(PaymentError, match="amountWei"):
            client.fetch("https://e.com")

    def test_accepts_challenge_at_root(self, session_mock, web3_mock):
        session_mock.post.side_effect = [
            response(402, make_challenge()),
            response(200, {"ok": True}),
        ]
        client = build_client(session_mock, web3_mock)

        result = client.fetch("https://e.com")
        assert result == {"ok": True}

    def test_402_with_non_json_body_raises(self, session_mock, web3_mock):
        bad = MagicMock()
        bad.status_code = 402
        bad.json.side_effect = ValueError("not json")
        bad.text = "<html>"
        session_mock.post.return_value = bad
        client = build_client(session_mock, web3_mock)

        with pytest.raises(PaymentError, match="402 response was not JSON"):
            client.fetch("https://e.com")

    def test_tx_reverted_raises_payment_error(self, session_mock, web3_mock):
        receipt = MagicMock()
        receipt.status = 0
        web3_mock.eth.wait_for_transaction_receipt.return_value = receipt

        session_mock.post.return_value = response(402, {"challenge": make_challenge()})
        client = build_client(session_mock, web3_mock)

        with pytest.raises(PaymentError, match="tx reverted"):
            client.fetch("https://e.com")

    def test_post_payment_failure_raises_payment_error(
        self, session_mock, web3_mock
    ):
        session_mock.post.side_effect = [
            response(402, {"challenge": make_challenge()}),
            response(502, {}, text="upstream"),
        ]
        client = build_client(session_mock, web3_mock)

        with pytest.raises(PaymentError, match="Post-payment fetch failed"):
            client.fetch("https://e.com")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class TestHelpers:
    def test_extract_challenge_happy(self):
        resp = response(402, {"challenge": make_challenge()})
        ch = _extract_challenge(resp)
        assert ch["nonce"] == "nonce-abc"

    def test_extract_challenge_requires_nonce(self):
        bad = make_challenge()
        bad.pop("nonce")
        resp = response(402, {"challenge": bad})
        with pytest.raises(PaymentError):
            _extract_challenge(resp)

    def test_hex_from_bytes(self):
        assert _hex(bytes.fromhex("ab" * 4)) == "0xabababab"

    def test_hex_from_hexbytes_like(self):
        class Fake:
            def hex(self):
                return "0xdeadbeef"

        assert _hex(Fake()) == "0xdeadbeef"

    def test_hex_from_plain_str(self):
        assert _hex("0x123") == "0x123"

    def test_preview_graceful_on_bad_text(self):
        resp = MagicMock()
        type(resp).text = property(lambda self: (_ for _ in ()).throw(RuntimeError()))
        assert _preview(resp) == "<no body>"
