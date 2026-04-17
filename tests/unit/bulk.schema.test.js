import { describe, it, expect } from 'vitest';
import { BulkItem, BulkRequest, BulkResponse } from '../../src/validators/bulk.schema.js';

describe('bulk.schema', () => {
  describe('BulkItem', () => {
    it('accepts valid id', () => {
      expect(BulkItem.safeParse({ id: 'item-1' })).toMatchObject({ success: true });
    });

    it('rejects empty id', () => {
      expect(BulkItem.safeParse({ id: '' }).success).toBe(false);
    });

    it('rejects id exceeding 256 chars', () => {
      expect(BulkItem.safeParse({ id: 'x'.repeat(257) }).success).toBe(false);
    });

    it('accepts id at 256-char boundary', () => {
      expect(BulkItem.safeParse({ id: 'x'.repeat(256) }).success).toBe(true);
    });

    it('rejects missing id', () => {
      expect(BulkItem.safeParse({}).success).toBe(false);
    });

    it('rejects non-string id', () => {
      expect(BulkItem.safeParse({ id: 123 }).success).toBe(false);
    });
  });

  describe('BulkRequest', () => {
    it('accepts 1 item', () => {
      const res = BulkRequest.safeParse({ items: [{ id: 'a' }] });
      expect(res.success).toBe(true);
      expect(res.data.items).toHaveLength(1);
    });

    it('accepts 10 items (max)', () => {
      const items = Array.from({ length: 10 }, (_, i) => ({ id: `item-${i}` }));
      expect(BulkRequest.safeParse({ items }).success).toBe(true);
    });

    it('rejects 11 items (over max)', () => {
      const items = Array.from({ length: 11 }, (_, i) => ({ id: `item-${i}` }));
      expect(BulkRequest.safeParse({ items }).success).toBe(false);
    });

    it('rejects empty items array', () => {
      expect(BulkRequest.safeParse({ items: [] }).success).toBe(false);
    });

    it('rejects missing items field', () => {
      expect(BulkRequest.safeParse({}).success).toBe(false);
    });

    it('rejects non-array items', () => {
      expect(BulkRequest.safeParse({ items: 'not-array' }).success).toBe(false);
    });

    it('rejects items with invalid entries', () => {
      expect(BulkRequest.safeParse({ items: [{ id: '' }] }).success).toBe(false);
    });

    it('strips unknown fields from items', () => {
      const res = BulkRequest.safeParse({ items: [{ id: 'a', extra: true }] });
      expect(res.success).toBe(true);
      expect(res.data.items[0]).not.toHaveProperty('extra');
    });
  });

  describe('BulkResponse', () => {
    const valid = {
      ok: true,
      txHash: '0xabc',
      resource: '/v1/resource/bulk',
      accountId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      items: [{ id: 'item-1', status: 'completed' }],
      totalItems: 1,
    };

    it('accepts valid response', () => {
      expect(BulkResponse.safeParse(valid).success).toBe(true);
    });

    it('rejects ok: false', () => {
      expect(BulkResponse.safeParse({ ...valid, ok: false }).success).toBe(false);
    });

    it('rejects non-uuid accountId', () => {
      expect(BulkResponse.safeParse({ ...valid, accountId: 'bad' }).success).toBe(false);
    });

    it('rejects zero totalItems', () => {
      expect(BulkResponse.safeParse({ ...valid, totalItems: 0 }).success).toBe(false);
    });

    it('rejects negative totalItems', () => {
      expect(BulkResponse.safeParse({ ...valid, totalItems: -1 }).success).toBe(false);
    });

    it('rejects item status other than completed', () => {
      const bad = { ...valid, items: [{ id: 'a', status: 'failed' }] };
      expect(BulkResponse.safeParse(bad).success).toBe(false);
    });
  });
});
