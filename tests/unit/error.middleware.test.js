import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/logger.js', () => ({
  withCorrelation: vi.fn(() => ({
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import {
  jsonResponse,
  toHttpResponse,
  paymentRequiredResponse,
} from '../../src/middleware/error.middleware.js';
import {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
  UpstreamError,
  PaymentRequiredError,
  FraudDetectedError,
} from '../../src/lib/errors.js';

const CID = 'corr-123';

describe('error.middleware', () => {
  describe('jsonResponse', () => {
    it('returns status, JSON body, and standard headers', () => {
      const res = jsonResponse(200, { ok: true });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/json');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(JSON.parse(res.body)).toEqual({ ok: true });
    });
  });

  describe('toHttpResponse', () => {
    it('maps TooManyRequestsError to 429 with retry-after header', () => {
      const err = new TooManyRequestsError(30);
      const res = toHttpResponse(err, CID);
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('30');
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(body.error.retryAfter).toBe(30);
      expect(body.correlationId).toBe(CID);
    });

    it('includes RateLimit-* headers on 429 response', () => {
      const err = new TooManyRequestsError(6, 100);
      const res = toHttpResponse(err, CID);
      expect(res.headers['ratelimit-limit']).toBe('100');
      expect(res.headers['ratelimit-remaining']).toBe('0');
      expect(res.headers['ratelimit-reset']).toBe('6');
    });

    it('defaults ratelimit-limit to 0 when limit not provided', () => {
      const err = new TooManyRequestsError(30);
      const res = toHttpResponse(err, CID);
      expect(res.headers['ratelimit-limit']).toBe('0');
      expect(res.headers['ratelimit-remaining']).toBe('0');
    });

    it('maps ValidationError to 400', () => {
      const err = new ValidationError({ field: 'email' });
      const res = toHttpResponse(err, CID);
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toEqual({ field: 'email' });
    });

    it('maps UnauthorizedError to 401', () => {
      const err = new UnauthorizedError('bad token');
      const res = toHttpResponse(err, CID);
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error.code).toBe('UNAUTHORIZED');
    });

    it('maps NotFoundError to 404', () => {
      const err = new NotFoundError('route');
      const res = toHttpResponse(err, CID);
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.message).toBe('route not found');
    });

    it('maps ConflictError to 409', () => {
      const err = new ConflictError('duplicate key');
      const res = toHttpResponse(err, CID);
      expect(res.statusCode).toBe(409);
    });

    it('maps FraudDetectedError to 403', () => {
      const err = new FraudDetectedError({ rule: 'velocity' });
      const res = toHttpResponse(err, CID);
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('FRAUD_DETECTED');
    });

    it('maps UpstreamError to 502', () => {
      const err = new UpstreamError('moonpay', { timeout: true });
      const res = toHttpResponse(err, CID);
      expect(res.statusCode).toBe(502);
      expect(JSON.parse(res.body).error.details).toEqual({ timeout: true });
    });

    it('maps unknown Error to 500 INTERNAL_ERROR', () => {
      const err = new Error('kaboom');
      const res = toHttpResponse(err, CID);
      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Internal server error');
      expect(body.correlationId).toBe(CID);
    });

    it('maps non-Error throw to 500', () => {
      const res = toHttpResponse('string-error', CID);
      expect(res.statusCode).toBe(500);
    });
  });

  describe('paymentRequiredResponse', () => {
    it('returns 402 with www-authenticate header and challenge', () => {
      const err = new PaymentRequiredError({
        nonce: 'n1',
        recipient: '0xabc',
        amount: '1000',
      });
      const res = paymentRequiredResponse(err, CID);
      expect(res.statusCode).toBe(402);
      expect(res.headers['www-authenticate']).toBe('X402');
      expect(res.headers['content-type']).toBe('application/json');
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('PAYMENT_REQUIRED');
      expect(body.challenge.nonce).toBe('n1');
      expect(body.correlationId).toBe(CID);
    });
  });
});
