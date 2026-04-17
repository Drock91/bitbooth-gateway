import { describe, it, expect } from 'vitest';
import { PaymentRequiredError, ValidationError, isAppError } from '../../src/lib/errors.js';

describe('errors', () => {
  it('PaymentRequiredError has 402 status', () => {
    const e = new PaymentRequiredError({ nonce: 'n' });
    expect(e.status).toBe(402);
    expect(isAppError(e)).toBe(true);
  });
  it('ValidationError is 400', () => {
    const e = new ValidationError({ field: 'x' });
    expect(e.status).toBe(400);
  });
});
