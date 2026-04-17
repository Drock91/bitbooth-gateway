import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHandleStripeWebhook = vi.fn();
const mockGetSecret = vi.fn();
const mockGetConfig = vi.fn();

vi.mock('../../src/controllers/stripe.controller.js', () => ({
  handleStripeWebhook: (...args) => mockHandleStripeWebhook(...args),
}));
vi.mock('../../src/lib/logger.js', () => ({
  withCorrelation: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  flushLogger: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/lib/secrets.js', () => ({
  getSecret: (...args) => mockGetSecret(...args),
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => mockGetConfig(),
}));

const { default: handler } = await import('../../src/handlers/stripe-webhook.handler.js');

function makeEvent(body = '{}', headers = {}) {
  return { body, headers };
}

describe('stripe-webhook.handler', () => {
  beforeEach(() => {
    mockHandleStripeWebhook.mockReset();
    mockGetSecret.mockReset();
    mockGetConfig.mockReset();
    mockGetConfig.mockReturnValue({
      secretArns: { stripe: 'arn:aws:secretsmanager:us-east-1:123:secret:stripe' },
    });
    mockGetSecret.mockResolvedValue('whsec_test');
  });

  it('fetches stripe secret from config ARN', async () => {
    mockHandleStripeWebhook.mockResolvedValue({ statusCode: 200, body: '{}' });
    await handler(makeEvent());
    expect(mockGetSecret).toHaveBeenCalledWith(
      'arn:aws:secretsmanager:us-east-1:123:secret:stripe',
    );
  });

  it('passes event and context to handleStripeWebhook', async () => {
    mockHandleStripeWebhook.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = makeEvent('{"type":"checkout"}', { 'stripe-signature': 'sig' });
    await handler(event);
    expect(mockHandleStripeWebhook).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ stripeWebhookSecret: 'whsec_test' }),
    );
  });

  it('passes a logger with info/error methods in context', async () => {
    mockHandleStripeWebhook.mockResolvedValue({ statusCode: 200, body: '{}' });
    await handler(makeEvent());
    const ctx = mockHandleStripeWebhook.mock.calls[0][1];
    expect(typeof ctx.log.info).toBe('function');
    expect(typeof ctx.log.error).toBe('function');
  });

  it('returns the controller result on success', async () => {
    const result = { statusCode: 200, body: '{"ok":true}' };
    mockHandleStripeWebhook.mockResolvedValue(result);
    const res = await handler(makeEvent());
    expect(res).toEqual(result);
  });

  it('returns 500 when controller throws a generic error', async () => {
    mockHandleStripeWebhook.mockRejectedValue(new Error('boom'));
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns correlationId in error responses', async () => {
    mockHandleStripeWebhook.mockRejectedValue(new Error('boom'));
    const res = await handler(makeEvent());
    const body = JSON.parse(res.body);
    expect(body.correlationId).toMatch(/^[0-9a-f]{8}-/);
  });

  it('returns mapped status for AppError from controller', async () => {
    const { UnauthorizedError } = await import('../../src/lib/errors.js');
    mockHandleStripeWebhook.mockRejectedValue(new UnauthorizedError('bad sig'));
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 500 when getSecret rejects', async () => {
    mockGetSecret.mockRejectedValue(new Error('secret not found'));
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 500 when getConfig throws', async () => {
    mockGetConfig.mockImplementation(() => {
      throw new Error('config missing');
    });
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
  });
});
