import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

const mockGetByStripeCustomerId = vi.fn();
const mockUpdatePlan = vi.fn();
const mockPlanChanged = vi.fn();

vi.mock('../../src/repositories/tenants.repo.js', () => ({
  tenantsRepo: {
    getByStripeCustomerId: (...a) => mockGetByStripeCustomerId(...a),
    updatePlan: (...a) => mockUpdatePlan(...a),
  },
}));
vi.mock('../../src/lib/metrics.js', () => ({
  planChanged: (...a) => mockPlanChanged(...a),
}));

import { stripeService } from '../../src/services/stripe.service.js';

const SECRET = 'whsec_test_secret_1234567890';
const ACCOUNT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const CUSTOMER_ID = 'cus_test123';

function makeSignature(payload, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return { header: `t=${timestamp},v1=${sig}`, timestamp };
}

function makeSubscriptionEvent(type, lookupKey = 'price_starter_monthly', status = 'active') {
  return {
    id: 'evt_test_001',
    type,
    data: {
      object: {
        id: 'sub_test_001',
        customer: CUSTOMER_ID,
        status,
        items: { data: [{ price: { lookup_key: lookupKey } }] },
      },
    },
  };
}

describe('stripeService', () => {
  beforeEach(() => {
    mockGetByStripeCustomerId.mockReset();
    mockUpdatePlan.mockReset();
    mockPlanChanged.mockReset();
  });

  describe('verifySignature', () => {
    it('accepts a valid signature', () => {
      const payload = '{"test":true}';
      const { header } = makeSignature(payload);
      expect(() => stripeService.verifySignature(payload, header, SECRET)).not.toThrow();
    });

    it('rejects missing signature header', () => {
      expect(() => stripeService.verifySignature('{}', '', SECRET)).toThrow(
        'Missing Stripe signature',
      );
    });

    it('rejects missing secret', () => {
      expect(() => stripeService.verifySignature('{}', 't=123,v1=abc', '')).toThrow(
        'Missing Stripe signature',
      );
    });

    it('rejects expired timestamp', () => {
      const payload = '{}';
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
      const { header } = makeSignature(payload, SECRET, oldTimestamp);
      expect(() => stripeService.verifySignature(payload, header, SECRET)).toThrow(
        'Stripe signature expired',
      );
    });

    it('rejects invalid timestamp', () => {
      expect(() => stripeService.verifySignature('{}', 't=notanumber,v1=abc', SECRET)).toThrow(
        'Invalid Stripe timestamp',
      );
    });

    it('rejects wrong signature', () => {
      const payload = '{"test":true}';
      const { header } = makeSignature(payload);
      const tampered = header.replace(/v1=[a-f0-9]+/, 'v1=' + 'a'.repeat(64));
      expect(() => stripeService.verifySignature(payload, tampered, SECRET)).toThrow(
        'Stripe signature mismatch',
      );
    });

    it('rejects missing v1 component', () => {
      const ts = Math.floor(Date.now() / 1000);
      expect(() => stripeService.verifySignature('{}', `t=${ts}`, SECRET)).toThrow(
        'Missing v1 signature',
      );
    });
  });

  describe('handleSubscriptionEvent', () => {
    const tenant = { accountId: ACCOUNT_ID, plan: 'free' };

    it('updates plan on subscription.created', async () => {
      mockGetByStripeCustomerId.mockResolvedValueOnce(tenant);
      mockUpdatePlan.mockResolvedValueOnce({ ...tenant, plan: 'starter' });

      const result = await stripeService.handleSubscriptionEvent(
        makeSubscriptionEvent('customer.subscription.created'),
      );
      expect(result.action).toBe('updated');
      expect(result.plan).toBe('starter');
      expect(mockUpdatePlan).toHaveBeenCalledWith(ACCOUNT_ID, 'starter');
    });

    it('updates plan on subscription.updated with growth tier', async () => {
      mockGetByStripeCustomerId.mockResolvedValueOnce(tenant);
      mockUpdatePlan.mockResolvedValueOnce({ ...tenant, plan: 'growth' });

      const result = await stripeService.handleSubscriptionEvent(
        makeSubscriptionEvent('customer.subscription.updated', 'price_growth_monthly'),
      );
      expect(result.plan).toBe('growth');
    });

    it('updates plan on subscription.updated with scale tier', async () => {
      mockGetByStripeCustomerId.mockResolvedValueOnce(tenant);
      mockUpdatePlan.mockResolvedValueOnce({ ...tenant, plan: 'scale' });

      const result = await stripeService.handleSubscriptionEvent(
        makeSubscriptionEvent('customer.subscription.updated', 'price_scale_monthly'),
      );
      expect(result.plan).toBe('scale');
    });

    it('downgrades to free on subscription.deleted', async () => {
      mockGetByStripeCustomerId.mockResolvedValueOnce(tenant);
      mockUpdatePlan.mockResolvedValueOnce({ ...tenant, plan: 'free' });

      const result = await stripeService.handleSubscriptionEvent(
        makeSubscriptionEvent('customer.subscription.deleted'),
      );
      expect(result.action).toBe('downgraded');
      expect(result.plan).toBe('free');
    });

    it('emits plan.changed metric on downgrade', async () => {
      mockGetByStripeCustomerId.mockResolvedValueOnce(tenant);
      mockUpdatePlan.mockResolvedValueOnce({ ...tenant, plan: 'free' });

      await stripeService.handleSubscriptionEvent(
        makeSubscriptionEvent('customer.subscription.deleted'),
      );
      expect(mockPlanChanged).toHaveBeenCalledWith({
        accountId: ACCOUNT_ID,
        plan: 'free',
        action: 'downgraded',
      });
    });

    it('emits plan.changed metric on upgrade', async () => {
      mockGetByStripeCustomerId.mockResolvedValueOnce(tenant);
      mockUpdatePlan.mockResolvedValueOnce({ ...tenant, plan: 'starter' });

      await stripeService.handleSubscriptionEvent(
        makeSubscriptionEvent('customer.subscription.created'),
      );
      expect(mockPlanChanged).toHaveBeenCalledWith({
        accountId: ACCOUNT_ID,
        plan: 'starter',
        action: 'updated',
      });
    });

    it('does not emit plan.changed for ignored events', async () => {
      await stripeService.handleSubscriptionEvent(
        makeSubscriptionEvent('invoice.payment_succeeded'),
      );
      expect(mockPlanChanged).not.toHaveBeenCalled();
    });

    it('ignores unhandled event types', async () => {
      const event = makeSubscriptionEvent('invoice.payment_succeeded');
      const result = await stripeService.handleSubscriptionEvent(event);
      expect(result.action).toBe('ignored');
    });

    it('throws when tenant not found for customer', async () => {
      mockGetByStripeCustomerId.mockResolvedValueOnce(null);
      const err = await stripeService
        .handleSubscriptionEvent(makeSubscriptionEvent('customer.subscription.created'))
        .catch((e) => e);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details).toMatch(/No tenant for Stripe customer/);
    });

    it('throws on unknown price lookup_key', async () => {
      mockGetByStripeCustomerId.mockResolvedValueOnce(tenant);
      const err = await stripeService
        .handleSubscriptionEvent(
          makeSubscriptionEvent('customer.subscription.created', 'price_unknown'),
        )
        .catch((e) => e);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details).toMatch(/Unknown price lookup_key/);
    });

    it('throws when lookup_key is missing (falsy branch)', async () => {
      mockGetByStripeCustomerId.mockResolvedValueOnce(tenant);
      const event = {
        id: 'evt_test_002',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_test_002',
            customer: CUSTOMER_ID,
            status: 'active',
            items: { data: [{ price: {} }] },
          },
        },
      };
      const err = await stripeService.handleSubscriptionEvent(event).catch((e) => e);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details).toMatch(/Unknown price lookup_key: undefined/);
    });

    it('ignores non-active subscriptions for create/update', async () => {
      mockGetByStripeCustomerId.mockResolvedValueOnce(tenant);
      const result = await stripeService.handleSubscriptionEvent(
        makeSubscriptionEvent('customer.subscription.updated', 'price_starter_monthly', 'past_due'),
      );
      expect(result.action).toBe('ignored');
      expect(mockUpdatePlan).not.toHaveBeenCalled();
    });
  });
});
