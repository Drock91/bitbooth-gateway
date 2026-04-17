import { Stack, Tags } from 'aws-cdk-lib';
import { Cors } from 'aws-cdk-lib/aws-apigateway';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Tables } from './constructs/tables.js';
import { Secrets } from './constructs/secrets.js';
import { Lambdas } from './constructs/lambdas.js';
import { ApiGateway } from './constructs/api-gateway.js';
import { Alarms } from './constructs/alarms.js';
import { Waf } from './constructs/waf.js';
import { OpsDashboard } from './constructs/dashboard.js';
import { HealthCanary } from './constructs/canary.js';

export class X402Stack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const { stage } = props;

    const tables = new Tables(this, 'Tables', { stage });
    const secrets = new Secrets(this, 'Secrets', { stage });

    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : Cors.ALL_ORIGINS;

    // Chain selection: staging/dev run on Base Sepolia, prod on Base mainnet.
    // Sepolia USDC is Circle's canonical test token with 6 decimals.
    const isProd = stage === 'prod';
    const chainId = isProd ? '8453' : '84532';
    const usdcContract = isProd
      ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
      : '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

    const commonEnv = {
      STAGE: stage,
      ALLOWED_ORIGINS: Array.isArray(allowedOrigins) ? allowedOrigins.join(',') : '*',
      LOG_LEVEL: stage === 'prod' ? 'warn' : 'info',
      CHAIN_ID: chainId,
      USDC_CONTRACT_ADDRESS: usdcContract,
      X402_PAYMENT_WINDOW_SECONDS: '120',
      // 1 conf for staging/dev (snappier demo); bump to 2 in prod.
      X402_REQUIRED_CONFIRMATIONS: isProd ? '2' : '1',
      AGENT_WALLET_SECRET_ARN: secrets.agentWallet.secretArn,
      STRIPE_WEBHOOK_SECRET_ARN: secrets.stripeWebhook.secretArn,
      BASE_RPC_SECRET_ARN: secrets.baseRpc.secretArn,
      MOONPAY_API_KEY_SECRET_ARN: secrets.moonpay.secretArn,
      COINBASE_API_KEY_SECRET_ARN: secrets.coinbase.secretArn,
      KRAKEN_API_KEY_SECRET_ARN: secrets.kraken.secretArn,
      BINANCE_API_KEY_SECRET_ARN: secrets.binance.secretArn,
      UPHOLD_API_KEY_SECRET_ARN: secrets.uphold.secretArn,
      PAYMENTS_TABLE: tables.payments.tableName,
      TENANTS_TABLE: tables.tenants.tableName,
      ROUTES_TABLE: tables.routes.tableName,
      USAGE_TABLE: tables.usage.tableName,
      RATE_LIMIT_TABLE: tables.rateLimit.tableName,
      IDEMPOTENCY_TABLE: tables.idempotency.tableName,
      FRAUD_EVENTS_TABLE: tables.fraudEvents.tableName,
      FRAUD_TALLY_TABLE: tables.fraudTally.tableName,
      AGENT_NONCES_TABLE: tables.agentNonces.tableName,
      WEBHOOK_DLQ_TABLE: tables.webhookDlq.tableName,
      FRAUD_MAX_PAYMENTS_PER_MINUTE: '5',
      FRAUD_MAX_PAYMENTS_PER_HOUR: '60',
      FRAUD_MAX_NONCE_FAILURES_PER_MINUTE: '3',
      FRAUD_MIN_AMOUNT_WEI: '1000',
      FRAUD_MAX_AMOUNT_WEI: '100000000000000000000',
      IDEMPOTENCY_TTL_SECONDS: '86400',
      FRAUD_EVENT_TTL_DAYS: '30',
      WEBHOOK_DLQ_TTL_DAYS: '30',
      SECRET_CACHE_TTL_MS: '300000',
      ADAPTER_HTTP_TIMEOUT_MS: '10000',
      ADMIN_API_KEY_HASH_SECRET_ARN: secrets.adminApiKeyHash.secretArn,
      SIGNUP_RATE_LIMIT_CAPACITY: '5',
      SIGNUP_RATE_LIMIT_REFILL_RATE: String(5 / 3600),
      HEALTH_RATE_LIMIT_CAPACITY: '60',
      HEALTH_RATE_LIMIT_REFILL_RATE: String(60 / 3600),
      RATE_LIMIT_FREE_CAPACITY: '10',
      RATE_LIMIT_STARTER_CAPACITY: '100',
      RATE_LIMIT_GROWTH_CAPACITY: '500',
      RATE_LIMIT_SCALE_CAPACITY: '2000',
      DLQ_MAX_RETRIES: '5',
      DLQ_SWEEP_BATCH_SIZE: '25',
      DLQ_BASE_DELAY_MS: '300000',
      DLQ_MAX_DELAY_MS: '14400000',
    };

    const lambdas = new Lambdas(this, 'Lambdas', { stage, tables, secrets, commonEnv });

    // Optional custom domain (e.g. app.heinrichstech.com for staging).
    // Both env vars must be set to provision; otherwise API GW is reachable
    // only via the execute-api URL.
    const customDomainName = process.env.X402_CUSTOM_DOMAIN_NAME;
    const customDomainCertArn = process.env.X402_CUSTOM_DOMAIN_CERT_ARN;
    const customDomain =
      customDomainName && customDomainCertArn
        ? {
            domainName: customDomainName,
            certificate: Certificate.fromCertificateArn(
              this,
              'CustomDomainCert',
              customDomainCertArn,
            ),
          }
        : undefined;

    const apiGw = new ApiGateway(this, 'ApiGw', { stage, lambdas, customDomain });
    const alarms = new Alarms(this, 'Alarms', { stage, lambdas, tables, apiGw });
    new Waf(this, 'Waf', { stage, apiGw });
    new OpsDashboard(this, 'OpsDashboard', { stage, lambdas, tables, apiGw });
    new HealthCanary(this, 'HealthCanary', { stage, apiGw, alarmTopic: alarms.alarmTopic });

    Tags.of(this).add('Environment', stage);
    Tags.of(this).add('Service', 'x402');
    Tags.of(this).add('ManagedBy', 'cdk');
  }
}
