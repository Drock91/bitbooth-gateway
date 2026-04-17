/**
 * Global setup for integration tests.
 * Sets env vars so AWS SDK v3 routes all calls to LocalStack
 * and getConfig() parses successfully.
 */
process.env.AWS_REGION ??= 'us-east-1';
process.env.AWS_ACCESS_KEY_ID ??= 'test';
process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
process.env.AWS_ENDPOINT_URL ??= 'http://localhost:4566';

process.env.STAGE ??= 'dev';
process.env.CHAIN_RPC_URL ??= 'http://localhost:8545';
process.env.CHAIN_ID ??= '8453';
process.env.USDC_CONTRACT_ADDRESS ??= '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
process.env.AGENT_WALLET_SECRET_ARN ??=
  'arn:aws:secretsmanager:us-east-1:000000000000:secret:agent-wallet';
