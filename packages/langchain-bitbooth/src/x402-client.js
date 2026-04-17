import { Wallet, JsonRpcProvider, Contract } from 'ethers';

const USDC_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];

const DEFAULT_API_URL = 'https://api.bitbooth.io';
const DEFAULT_CONFIRMATIONS = 2;

const CHAINS = {
  8453: {
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
};

export function createX402Client(opts = {}) {
  const apiUrl = opts.apiUrl || process.env.BITBOOTH_API_URL || DEFAULT_API_URL;
  const apiKey = opts.apiKey || process.env.BITBOOTH_API_KEY || undefined;
  const agentKey = opts.agentKey || process.env.BITBOOTH_AGENT_KEY;
  const confirmations =
    Number(opts.confirmations || process.env.BITBOOTH_CONFIRMATIONS) || DEFAULT_CONFIRMATIONS;

  if (!agentKey) {
    throw new Error(
      'Agent wallet key required. Set BITBOOTH_AGENT_KEY env var or pass agentKey option.',
    );
  }

  const chainId = Number(opts.chainId || process.env.BITBOOTH_CHAIN_ID) || 8453;
  const chain = CHAINS[chainId];
  if (!chain) {
    throw new Error(
      `Unsupported chain ID: ${chainId}. Supported: ${Object.keys(CHAINS).join(', ')}`,
    );
  }

  const rpcUrl = opts.rpcUrl || process.env.BITBOOTH_RPC_URL || chain.rpcUrl;
  const provider = new JsonRpcProvider(rpcUrl, chainId);
  const wallet = new Wallet(agentKey, provider);
  const usdc = new Contract(chain.usdcContract, USDC_ABI, wallet);

  async function fetchWithPayment(url, mode = 'fast') {
    const headers = { 'content-type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;

    const body = JSON.stringify({ url, mode });

    const res1 = await fetch(`${apiUrl}/v1/fetch`, {
      method: 'POST',
      headers,
      body,
    });

    if (res1.status === 200) {
      return res1.json();
    }

    if (res1.status !== 402) {
      const text = await res1.text();
      throw new Error(`Unexpected HTTP ${res1.status}: ${text}`);
    }

    const { challenge } = await res1.json();
    if (!challenge?.nonce) {
      throw new Error('402 response missing challenge.nonce');
    }

    const tx = await usdc.transfer(challenge.payTo, BigInt(challenge.amountWei));
    const receipt = await tx.wait(confirmations);
    if (receipt.status !== 1) {
      throw new Error(`Payment tx reverted: ${tx.hash}`);
    }

    const xPayment = JSON.stringify({
      nonce: challenge.nonce,
      txHash: tx.hash,
      signature: 'langchain-bitbooth',
    });

    const res2 = await fetch(`${apiUrl}/v1/fetch`, {
      method: 'POST',
      headers: { ...headers, 'x-payment': xPayment },
      body,
    });

    if (res2.status !== 200) {
      const text = await res2.text();
      throw new Error(`Post-payment fetch failed (HTTP ${res2.status}): ${text}`);
    }

    return res2.json();
  }

  return { fetchWithPayment, wallet, provider };
}
