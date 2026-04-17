import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class Secrets extends Construct {
  constructor(scope, id, { stage }) {
    super(scope, id);

    this.agentWallet = new Secret(this, 'AgentWalletSecret', {
      secretName: `x402/${stage}/agent-wallet`,
      description: 'Agent wallet private key for Base USDC micropayments',
    });

    this.stripeWebhook = new Secret(this, 'StripeWebhookSecret', {
      secretName: `x402/${stage}/stripe-webhook`,
      description: 'Stripe webhook signing secret (whsec_…)',
    });

    this.baseRpc = new Secret(this, 'BaseRpcSecret', {
      secretName: `x402/${stage}/base-rpc`,
      description: 'Base mainnet RPC URL (may contain API key)',
    });

    this.adminApiKeyHash = new Secret(this, 'AdminApiKeyHashSecret', {
      secretName: `x402/${stage}/admin-api-key-hash`,
      description: 'SHA-256 hash of the admin API key for /admin endpoints',
    });

    this.moonpay = new Secret(this, 'MoonpayApiKeySecret', {
      secretName: `x402/${stage}/exchanges/moonpay`,
      description: 'Moonpay API key + webhook secret JSON',
    });

    this.coinbase = new Secret(this, 'CoinbaseApiKeySecret', {
      secretName: `x402/${stage}/exchanges/coinbase`,
      description: 'Coinbase API key + webhook secret JSON',
    });

    this.kraken = new Secret(this, 'KrakenApiKeySecret', {
      secretName: `x402/${stage}/exchanges/kraken`,
      description: 'Kraken API key + webhook secret JSON',
    });

    this.binance = new Secret(this, 'BinanceApiKeySecret', {
      secretName: `x402/${stage}/exchanges/binance`,
      description: 'Binance API key + webhook secret JSON',
    });

    this.uphold = new Secret(this, 'UpholdApiKeySecret', {
      secretName: `x402/${stage}/exchanges/uphold`,
      description: 'Uphold API key + webhook secret JSON',
    });
  }
}
