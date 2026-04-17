#!/usr/bin/env bash
# 01 — Bare curl walkthrough of the BitBooth x402 flow
#
# This script just SHOWS the 402 challenge. It doesn't pay (so no money moves).
# Use it to understand the protocol before wiring up a real payment.
#
# Real payment examples:
#   ./02-node-evm-pay.mjs   (free testnet USDC on Base Sepolia)
#   ./03-node-xrpl-pay.mjs  (real XRP on XRPL Mainnet)

set -e

API="${BITBOOTH_API_URL:-https://app.heinrichstech.com}"

echo "=== Step 1: cold POST to /v1/fetch (no payment) ==="
echo "Expect: HTTP 402 Payment Required + a challenge with payment options"
echo ""

curl -s -X POST "$API/v1/fetch" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","mode":"fast"}' \
  -w "\n\n[HTTP %{http_code}]\n"

echo ""
echo "=== Step 2: pick one of the 'accepts' options and pay on-chain ==="
echo "  - eip155:84532 (Base Sepolia) → free testnet USDC, see ./02-node-evm-pay.mjs"
echo "  - xrpl:0       (XRPL Mainnet) → real XRP (~\$0.003), see ./03-node-xrpl-pay.mjs"
echo ""
echo "=== Step 3: retry with X-Payment header ==="
echo "  X-Payment is JSON: {nonce, txHash, network, signature}"
echo "  - nonce comes from the challenge in step 1"
echo "  - txHash comes from your on-chain payment in step 2"
echo "  - network = same CAIP-2 ID you paid on"
echo "  - signature = any non-empty string (reserved for future spec)"
echo ""
echo "Done. Run a real-payment example to see steps 2+3 in action."
