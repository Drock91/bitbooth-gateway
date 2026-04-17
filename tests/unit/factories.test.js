import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTestTenant,
  createTestRoute,
  createTestPayment,
  createTestFraudEvent,
  createTestRateLimitBucket,
  createTestWebhookDlqEntry,
  createTestAgentNonce,
  resetFactorySeq,
} from '../helpers/factories.js';
import { TenantItem } from '../../src/validators/tenant.schema.js';
import { RouteItem } from '../../src/validators/route.schema.js';
import { FraudEvent } from '../../src/validators/fraud.schema.js';
import { WebhookDlqItem } from '../../src/validators/webhook-dlq.schema.js';
import { AgentNonceItem } from '../../src/validators/agent-nonce.schema.js';

beforeEach(() => {
  resetFactorySeq();
});

describe('createTestTenant', () => {
  it('returns a valid TenantItem', () => {
    const t = createTestTenant();
    expect(() => TenantItem.parse(t)).not.toThrow();
  });

  it('generates unique accountId per call', () => {
    const a = createTestTenant();
    const b = createTestTenant();
    expect(a.accountId).not.toBe(b.accountId);
  });

  it('generates unique apiKeyHash per call', () => {
    const a = createTestTenant();
    const b = createTestTenant();
    expect(a.apiKeyHash).not.toBe(b.apiKeyHash);
  });

  it('accepts overrides', () => {
    const t = createTestTenant({ plan: 'growth', stripeCustomerId: 'cus_abc' });
    expect(t.plan).toBe('growth');
    expect(t.stripeCustomerId).toBe('cus_abc');
    expect(() => TenantItem.parse(t)).not.toThrow();
  });

  it('defaults to free plan', () => {
    expect(createTestTenant().plan).toBe('free');
  });
});

describe('createTestRoute', () => {
  it('returns a valid RouteItem', () => {
    const r = createTestRoute();
    expect(() => RouteItem.parse(r)).not.toThrow();
  });

  it('generates unique paths per call', () => {
    const a = createTestRoute();
    const b = createTestRoute();
    expect(a.path).not.toBe(b.path);
  });

  it('path starts with /', () => {
    expect(createTestRoute().path).toMatch(/^\//);
  });

  it('accepts overrides including fraudRules', () => {
    const r = createTestRoute({
      priceWei: '9999',
      fraudRules: { maxAmountWei: '50000', velocityPerMinute: 5 },
    });
    expect(r.priceWei).toBe('9999');
    expect(r.fraudRules.velocityPerMinute).toBe(5);
    expect(() => RouteItem.parse(r)).not.toThrow();
  });
});

describe('createTestPayment', () => {
  it('has required fields', () => {
    const p = createTestPayment();
    expect(p.idempotencyKey).toBeDefined();
    expect(p.accountId).toBeDefined();
    expect(p.amountWei).toMatch(/^\d+$/);
    expect(p.status).toBe('pending');
  });

  it('generates unique idempotencyKey per call', () => {
    const a = createTestPayment();
    const b = createTestPayment();
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });

  it('accepts overrides for confirmed payment', () => {
    const p = createTestPayment({
      status: 'confirmed',
      txHash: '0x' + 'a'.repeat(64),
      blockNumber: 42,
      confirmedAt: '2026-04-06T12:00:00.000Z',
    });
    expect(p.status).toBe('confirmed');
    expect(p.txHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(p.blockNumber).toBe(42);
  });
});

describe('createTestFraudEvent', () => {
  it('returns a valid FraudEvent', () => {
    const e = createTestFraudEvent();
    expect(() => FraudEvent.parse(e)).not.toThrow();
  });

  it('accepts overrides for event type and severity', () => {
    const e = createTestFraudEvent({
      eventType: 'abnormal_amount',
      severity: 'high',
      details: { reason: 'over limit' },
    });
    expect(e.eventType).toBe('abnormal_amount');
    expect(e.severity).toBe('high');
    expect(e.details.reason).toBe('over limit');
    expect(() => FraudEvent.parse(e)).not.toThrow();
  });

  it('accepts optional ttl', () => {
    const e = createTestFraudEvent({ ttl: 86400 });
    expect(() => FraudEvent.parse(e)).not.toThrow();
  });
});

describe('createTestRateLimitBucket', () => {
  it('has valid defaults', () => {
    const b = createTestRateLimitBucket();
    expect(b.tokens).toBe(100);
    expect(b.capacity).toBe(100);
    expect(b.refillRate).toBe(10);
    expect(b.lastRefillAt).toBeDefined();
  });

  it('generates unique accountId per call', () => {
    const a = createTestRateLimitBucket();
    const b = createTestRateLimitBucket();
    expect(a.accountId).not.toBe(b.accountId);
  });

  it('accepts overrides', () => {
    const b = createTestRateLimitBucket({ tokens: 0, capacity: 50 });
    expect(b.tokens).toBe(0);
    expect(b.capacity).toBe(50);
  });
});

describe('createTestWebhookDlqEntry', () => {
  it('returns a valid WebhookDlqItem', () => {
    const e = createTestWebhookDlqEntry();
    expect(() => WebhookDlqItem.parse(e)).not.toThrow();
  });

  it('generates unique eventId per call', () => {
    const a = createTestWebhookDlqEntry();
    const b = createTestWebhookDlqEntry();
    expect(a.eventId).not.toBe(b.eventId);
  });

  it('accepts provider override', () => {
    const e = createTestWebhookDlqEntry({ provider: 'kraken', retryCount: 3 });
    expect(e.provider).toBe('kraken');
    expect(e.retryCount).toBe(3);
    expect(() => WebhookDlqItem.parse(e)).not.toThrow();
  });
});

describe('createTestAgentNonce', () => {
  it('returns a valid AgentNonceItem', () => {
    const n = createTestAgentNonce();
    expect(() => AgentNonceItem.parse(n)).not.toThrow();
  });

  it('wallet address is valid EVM format', () => {
    expect(createTestAgentNonce().walletAddress).toMatch(/^0x[a-f0-9]{40}$/);
  });

  it('accepts overrides', () => {
    const n = createTestAgentNonce({ currentNonce: 42 });
    expect(n.currentNonce).toBe(42);
    expect(() => AgentNonceItem.parse(n)).not.toThrow();
  });
});

describe('resetFactorySeq', () => {
  it('resets sequence so paths repeat', () => {
    const a = createTestRoute();
    resetFactorySeq();
    const b = createTestRoute();
    expect(a.path).toBe(b.path);
  });
});
