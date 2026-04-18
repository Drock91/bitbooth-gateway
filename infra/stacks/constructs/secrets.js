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

  }
}
