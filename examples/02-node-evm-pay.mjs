#!/usr/bin/env node
/**
 * 02 — Pay USDC on Base Sepolia (testnet, free) from Node.js
 *
 * Cost:    Free (testnet). Get USDC from https://faucet.circle.com (Base Sepolia)
 *          and gas ETH from https://www.alchemy.com/faucets/base-sepolia
 *
 * Run:     BITBOOTH_AGENT_KEY=0x... node examples/02-node-evm-pay.mjs
 */

import { createX402Client } from '@bitbooth/mcp-fetch/x402-client';

const URL_TO_FETCH = process.argv[2] || 'https://example.com';

if (!process.env.BITBOOTH_AGENT_KEY) {
  console.error('Set BITBOOTH_AGENT_KEY=0x<your-base-sepolia-wallet-pk>');
  console.error('Faucets:');
  console.error('  ETH for gas: https://www.alchemy.com/faucets/base-sepolia');
  console.error('  USDC:        https://faucet.circle.com   (select Base Sepolia)');
  process.exit(1);
}

const client = createX402Client({
  // Defaults: Base Sepolia testnet, https://app.heinrichstech.com gateway.
  // For mainnet add: chainId: 8453, rpcUrl: 'https://base-rpc.publicnode.com'
});

console.log(`Fetching ${URL_TO_FETCH} (will pay 0.005 USDC on Base Sepolia)...`);
const start = Date.now();
const result = await client.fetchWithPayment(URL_TO_FETCH, 'fast');
const ms = Date.now() - start;

console.log('');
console.log(`=== TITLE: ${result.title || '(none)'} ===`);
console.log(result.markdown.slice(0, 500));
console.log(result.markdown.length > 500 ? '\n...[truncated]' : '');
console.log('');
console.log(`Done in ${ms}ms. Bytes: ${result.metadata.contentLength}`);
