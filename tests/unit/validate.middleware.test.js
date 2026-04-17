import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseBody, parseQuery } from '../../src/middleware/validate.middleware.js';
import { ValidationError } from '../../src/lib/errors.js';

const bodySchema = z.object({
  name: z.string(),
  age: z.number().int().positive(),
});

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(20),
});

describe('validate.middleware', () => {
  describe('parseBody', () => {
    it('returns validated data for valid JSON', () => {
      const data = parseBody(bodySchema, JSON.stringify({ name: 'Alice', age: 30 }));
      expect(data).toEqual({ name: 'Alice', age: 30 });
    });

    it('throws ValidationError when raw is null', () => {
      expect(() => parseBody(bodySchema, null)).toThrow(ValidationError);
      try {
        parseBody(bodySchema, null);
      } catch (e) {
        expect(e.details).toEqual({ body: 'missing' });
        expect(e.status).toBe(400);
      }
    });

    it('throws ValidationError when raw is undefined', () => {
      expect(() => parseBody(bodySchema, undefined)).toThrow(ValidationError);
    });

    it('throws ValidationError when raw is empty string', () => {
      expect(() => parseBody(bodySchema, '')).toThrow(ValidationError);
    });

    it('throws ValidationError for malformed JSON', () => {
      expect(() => parseBody(bodySchema, '{not json')).toThrow(ValidationError);
      try {
        parseBody(bodySchema, '{broken');
      } catch (e) {
        expect(e.details).toEqual({ body: 'invalid-json' });
      }
    });

    it('throws ValidationError when schema validation fails', () => {
      const raw = JSON.stringify({ name: 123, age: -5 });
      expect(() => parseBody(bodySchema, raw)).toThrow(ValidationError);
      try {
        parseBody(bodySchema, raw);
      } catch (e) {
        expect(e.details).toHaveProperty('fieldErrors');
      }
    });

    it('strips unknown fields via schema', () => {
      const strict = z.object({ x: z.string() });
      const data = parseBody(strict, JSON.stringify({ x: 'hi', extra: true }));
      expect(data).toEqual({ x: 'hi' });
    });
  });

  describe('parseQuery', () => {
    it('returns validated data for valid query', () => {
      const data = parseQuery(querySchema, { page: '2', limit: '50' });
      expect(data).toEqual({ page: 2, limit: 50 });
    });

    it('applies defaults when query is empty object', () => {
      const data = parseQuery(querySchema, {});
      expect(data).toEqual({ page: 1, limit: 20 });
    });

    it('applies defaults when query is null', () => {
      const data = parseQuery(querySchema, null);
      expect(data).toEqual({ page: 1, limit: 20 });
    });

    it('applies defaults when query is undefined', () => {
      const data = parseQuery(querySchema, undefined);
      expect(data).toEqual({ page: 1, limit: 20 });
    });

    it('throws ValidationError for invalid query params', () => {
      const strict = z.object({ status: z.enum(['active', 'inactive']) });
      expect(() => parseQuery(strict, { status: 'bogus' })).toThrow(ValidationError);
    });
  });
});
