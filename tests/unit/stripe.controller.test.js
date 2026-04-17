import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifySignature = vi.fn();
const mockHandleSubscriptionEvent = vi.fn();

vi.mock('../../src/services/stripe.service.js', () => ({
  stripeService: {
    verifySignature: (...a) => mockVerifySignature(...a),
    handleSubscriptionEvent: (...a) => mockHandleSubscriptionEvent(...a),
  },
}));

import { handleStripeWebhook } from '../../src/controllers/stripe.controller.js';

const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeEvent(body, sig = 't=123,v1=abc') {
  return {
    body,
    headers: { 'stripe-signature': sig },
  };
}

describe('handleStripeWebhook', () => {
  beforeEach(() => {
    mockVerifySignature.mockReset();
    mockHandleSubscriptionEvent.mockReset();
    mockLog.info.mockReset();
  });

  it('returns 200 with result on success', async () => {
    mockHandleSubscriptionEvent.mockResolvedValueOnce({ action: 'updated', plan: 'starter' });

    const event = makeEvent(
      '{"id":"evt_1","type":"customer.subscription.created","data":{"object":{"id":"sub_1","customer":"cus_1","status":"active","items":{"data":[{"price":{"lookup_key":"price_starter_monthly"}}]}}}}',
    );
    const res = await handleStripeWebhook(event, { log: mockLog, stripeWebhookSecret: 'secret' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.action).toBe('updated');
  });

  it('calls verifySignature with correct args', async () => {
    mockHandleSubscriptionEvent.mockResolvedValueOnce({ action: 'ignored' });
    const payload = '{"type":"test"}';
    const event = makeEvent(payload, 't=999,v1=sig');
    await handleStripeWebhook(event, { log: mockLog, stripeWebhookSecret: 'my-secret' });

    expect(mockVerifySignature).toHaveBeenCalledWith(payload, 't=999,v1=sig', 'my-secret');
  });

  it('propagates verification errors', async () => {
    mockVerifySignature.mockImplementation(() => {
      throw new Error('bad sig');
    });

    const event = makeEvent('{}');
    await expect(
      handleStripeWebhook(event, { log: mockLog, stripeWebhookSecret: 'secret' }),
    ).rejects.toThrow('bad sig');
  });

  it('uses empty string for missing body and passes it to verifySignature', async () => {
    mockVerifySignature.mockImplementation(() => {
      throw new Error('bad sig');
    });

    const event = { body: undefined, headers: { 'stripe-signature': 'sig' } };
    await expect(
      handleStripeWebhook(event, { log: mockLog, stripeWebhookSecret: 'secret' }),
    ).rejects.toThrow('bad sig');

    expect(mockVerifySignature).toHaveBeenCalledWith('', 'sig', 'secret');
  });

  it('falls back to Stripe-Signature header (capital S)', async () => {
    mockHandleSubscriptionEvent.mockResolvedValueOnce({ action: 'ignored' });
    const event = { body: '{"type":"test"}', headers: { 'Stripe-Signature': 'cap-sig' } };
    await handleStripeWebhook(event, { log: mockLog, stripeWebhookSecret: 'secret' });

    expect(mockVerifySignature).toHaveBeenCalledWith('{"type":"test"}', 'cap-sig', 'secret');
  });

  it('uses empty string when neither signature header is present', async () => {
    mockVerifySignature.mockImplementation(() => {
      throw new Error('no sig');
    });
    const event = { body: '{}', headers: {} };
    await expect(
      handleStripeWebhook(event, { log: mockLog, stripeWebhookSecret: 'secret' }),
    ).rejects.toThrow('no sig');

    expect(mockVerifySignature).toHaveBeenCalledWith('{}', '', 'secret');
  });

  it('uses empty string when headers object is null', async () => {
    mockVerifySignature.mockImplementation(() => {
      throw new Error('no sig');
    });
    const event = { body: '{}', headers: null };
    await expect(
      handleStripeWebhook(event, { log: mockLog, stripeWebhookSecret: 'secret' }),
    ).rejects.toThrow('no sig');

    expect(mockVerifySignature).toHaveBeenCalledWith('{}', '', 'secret');
  });

  it('prefers stripe-signature over Stripe-Signature when both present', async () => {
    mockHandleSubscriptionEvent.mockResolvedValueOnce({ action: 'ignored' });
    const event = {
      body: '{"type":"test"}',
      headers: { 'stripe-signature': 'lower', 'Stripe-Signature': 'upper' },
    };
    await handleStripeWebhook(event, { log: mockLog, stripeWebhookSecret: 'secret' });

    expect(mockVerifySignature).toHaveBeenCalledWith('{"type":"test"}', 'lower', 'secret');
  });
});
