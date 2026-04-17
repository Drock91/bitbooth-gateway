import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInfo } = vi.hoisted(() => ({ mockInfo: vi.fn() }));

vi.mock('../../src/lib/logger.js', () => ({
  logger: { info: mockInfo },
}));

import {
  emitMetric,
  paymentVerified,
  paymentFailed,
  tenantSignup,
  routeCreated,
  routeDeleted,
  apiKeyRotated,
  planChanged,
} from '../../src/lib/metrics.js';

describe('lib/metrics', () => {
  beforeEach(() => {
    mockInfo.mockReset();
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  describe('emitMetric', () => {
    it('emits EMF-formatted log with default count=1', () => {
      emitMetric('test.metric');

      expect(mockInfo).toHaveBeenCalledOnce();
      const [emf, msg] = mockInfo.mock.calls[0];
      expect(msg).toBe('metric:test.metric');
      expect(emf._aws.Timestamp).toBe(1700000000000);
      expect(emf._aws.CloudWatchMetrics[0].Namespace).toBe('x402');
      expect(emf._aws.CloudWatchMetrics[0].Metrics[0]).toEqual({
        Name: 'test.metric',
        Unit: 'Count',
      });
      expect(emf['test.metric']).toBe(1);
    });

    it('accepts custom value, unit, and dimensions', () => {
      emitMetric('latency', {
        value: 42,
        unit: 'Milliseconds',
        dimensions: { route: '/v1/quote' },
      });

      const [emf] = mockInfo.mock.calls[0];
      expect(emf['latency']).toBe(42);
      expect(emf._aws.CloudWatchMetrics[0].Metrics[0].Unit).toBe('Milliseconds');
      expect(emf._aws.CloudWatchMetrics[0].Dimensions).toEqual([['route']]);
      expect(emf.route).toBe('/v1/quote');
    });

    it('uses empty dimension array when none provided', () => {
      emitMetric('simple');

      const [emf] = mockInfo.mock.calls[0];
      expect(emf._aws.CloudWatchMetrics[0].Dimensions).toEqual([[]]);
    });

    it('includes multiple dimension keys', () => {
      emitMetric('multi', { dimensions: { a: '1', b: '2', c: '3' } });

      const [emf] = mockInfo.mock.calls[0];
      expect(emf._aws.CloudWatchMetrics[0].Dimensions).toEqual([['a', 'b', 'c']]);
      expect(emf.a).toBe('1');
      expect(emf.b).toBe('2');
      expect(emf.c).toBe('3');
    });
  });

  describe('paymentVerified', () => {
    it('emits payment.verified with accountId and route dimensions', () => {
      paymentVerified({ accountId: 'acc-1', route: '/v1/data' });

      const [emf, msg] = mockInfo.mock.calls[0];
      expect(msg).toBe('metric:payment.verified');
      expect(emf['payment.verified']).toBe(1);
      expect(emf.accountId).toBe('acc-1');
      expect(emf.route).toBe('/v1/data');
    });
  });

  describe('paymentFailed', () => {
    it('emits payment.failed with reason dimension', () => {
      paymentFailed({ accountId: 'acc-2', route: '/v1/quote', reason: 'nonce_reuse' });

      const [emf, msg] = mockInfo.mock.calls[0];
      expect(msg).toBe('metric:payment.failed');
      expect(emf['payment.failed']).toBe(1);
      expect(emf.reason).toBe('nonce_reuse');
      expect(emf.accountId).toBe('acc-2');
    });

    it('includes verification failure reason', () => {
      paymentFailed({ accountId: 'acc-3', route: '/v1/data', reason: 'amount_mismatch' });

      const [emf] = mockInfo.mock.calls[0];
      expect(emf.reason).toBe('amount_mismatch');
    });
  });

  describe('tenantSignup', () => {
    it('emits tenant.signup with accountId and plan', () => {
      tenantSignup({ accountId: 'acc-4', plan: 'free' });

      const [emf, msg] = mockInfo.mock.calls[0];
      expect(msg).toBe('metric:tenant.signup');
      expect(emf['tenant.signup']).toBe(1);
      expect(emf.accountId).toBe('acc-4');
      expect(emf.plan).toBe('free');
    });

    it('includes paid plan in dimensions', () => {
      tenantSignup({ accountId: 'acc-5', plan: 'pro' });

      const [emf] = mockInfo.mock.calls[0];
      expect(emf.plan).toBe('pro');
    });
  });

  describe('routeCreated', () => {
    it('emits route.created with accountId and path', () => {
      routeCreated({ accountId: 'acc-10', path: '/v1/data' });

      const [emf, msg] = mockInfo.mock.calls[0];
      expect(msg).toBe('metric:route.created');
      expect(emf['route.created']).toBe(1);
      expect(emf.accountId).toBe('acc-10');
      expect(emf.path).toBe('/v1/data');
    });
  });

  describe('routeDeleted', () => {
    it('emits route.deleted with accountId and path', () => {
      routeDeleted({ accountId: 'acc-11', path: '/v1/old' });

      const [emf, msg] = mockInfo.mock.calls[0];
      expect(msg).toBe('metric:route.deleted');
      expect(emf['route.deleted']).toBe(1);
      expect(emf.accountId).toBe('acc-11');
      expect(emf.path).toBe('/v1/old');
    });
  });

  describe('apiKeyRotated', () => {
    it('emits apiKey.rotated with accountId', () => {
      apiKeyRotated({ accountId: 'acc-12' });

      const [emf, msg] = mockInfo.mock.calls[0];
      expect(msg).toBe('metric:apiKey.rotated');
      expect(emf['apiKey.rotated']).toBe(1);
      expect(emf.accountId).toBe('acc-12');
    });
  });

  describe('planChanged', () => {
    it('emits plan.changed with accountId, plan, and action', () => {
      planChanged({ accountId: 'acc-13', plan: 'starter', action: 'updated' });

      const [emf, msg] = mockInfo.mock.calls[0];
      expect(msg).toBe('metric:plan.changed');
      expect(emf['plan.changed']).toBe(1);
      expect(emf.accountId).toBe('acc-13');
      expect(emf.plan).toBe('starter');
      expect(emf.action).toBe('updated');
    });

    it('includes downgraded action dimension', () => {
      planChanged({ accountId: 'acc-14', plan: 'free', action: 'downgraded' });

      const [emf] = mockInfo.mock.calls[0];
      expect(emf.action).toBe('downgraded');
      expect(emf.plan).toBe('free');
    });
  });
});
