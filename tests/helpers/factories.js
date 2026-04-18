import { randomUUID, createHash } from 'node:crypto';

let _seq = 0;
function seq() {
  return ++_seq;
}

function hexChars(len) {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < len; i++) out += hex[i % 16];
  return out;
}

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

const NOW = '2026-04-06T00:00:00.000Z';

/**
 * Build a valid Tenant object. All fields satisfy Zod constraints.
 * @param {Record<string, unknown>} [overrides]
 */
export function createTestTenant(overrides = {}) {
  const n = seq();
  return {
    accountId: randomUUID(),
    apiKeyHash: sha256Hex(`test-key-${n}`),
    plan: 'free',
    stripeCustomerId: `cus_test_${n}`,
    createdAt: NOW,
    ...overrides,
  };
}

/**
 * Build a valid Route object.
 * @param {Record<string, unknown>} [overrides]
 */
export function createTestRoute(overrides = {}) {
  return {
    tenantId: randomUUID(),
    path: `/v1/resource-${seq()}`,
    priceWei: '1000000',
    asset: 'USDC',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/**
 * Build a valid Payment object.
 * @param {Record<string, unknown>} [overrides]
 */
export function createTestPayment(overrides = {}) {
  return {
    idempotencyKey: randomUUID(),
    accountId: randomUUID(),
    amountWei: '5000000',
    assetSymbol: 'USDC',
    status: 'pending',
    createdAt: NOW,
    ...overrides,
  };
}

/**
 * Build a valid FraudEvent object.
 * @param {Record<string, unknown>} [overrides]
 */
export function createTestFraudEvent(overrides = {}) {
  return {
    accountId: randomUUID(),
    timestamp: NOW,
    eventType: 'high_velocity',
    severity: 'medium',
    details: {},
    ...overrides,
  };
}

/**
 * Build a valid RateLimitBucket object.
 * @param {Record<string, unknown>} [overrides]
 */
export function createTestRateLimitBucket(overrides = {}) {
  return {
    accountId: randomUUID(),
    tokens: 100,
    lastRefillAt: NOW,
    capacity: 100,
    refillRate: 10,
    ...overrides,
  };
}

/**
 * Build a valid WebhookDlqEntry object.
 * @param {Record<string, unknown>} [overrides]
 */
export function createTestWebhookDlqEntry(overrides = {}) {
  return {
    eventId: randomUUID(),
    provider: 'test-provider',
    payload: '{"type":"charge:confirmed"}',
    headers: { 'x-webhook-signature': 'sig123' },
    errorMessage: 'Signature mismatch',
    errorCode: 'HMAC_INVALID',
    status: 'pending',
    retryCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/**
 * Build a valid AgentNonce object.
 * @param {Record<string, unknown>} [overrides]
 */
export function createTestAgentNonce(overrides = {}) {
  return {
    walletAddress: `0x${hexChars(40)}`,
    currentNonce: 0,
    lastUsedAt: NOW,
    ...overrides,
  };
}

/** Reset the internal sequence counter (useful between test suites). */
export function resetFactorySeq() {
  _seq = 0;
}
