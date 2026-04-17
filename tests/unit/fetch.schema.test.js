import { describe, it, expect } from 'vitest';
import {
  FetchMode,
  FetchRequest,
  FetchMetadata,
  FetchResponse,
} from '../../src/validators/fetch.schema.js';

describe('fetch.schema', () => {
  describe('FetchMode', () => {
    it('accepts "fast"', () => {
      expect(FetchMode.safeParse('fast')).toMatchObject({ success: true, data: 'fast' });
    });

    it('accepts "full"', () => {
      expect(FetchMode.safeParse('full')).toMatchObject({ success: true, data: 'full' });
    });

    it('rejects unknown mode', () => {
      expect(FetchMode.safeParse('turbo').success).toBe(false);
    });

    it('rejects empty string', () => {
      expect(FetchMode.safeParse('').success).toBe(false);
    });

    it('rejects non-string types', () => {
      expect(FetchMode.safeParse(1).success).toBe(false);
      expect(FetchMode.safeParse(null).success).toBe(false);
      expect(FetchMode.safeParse(undefined).success).toBe(false);
    });
  });

  describe('FetchRequest', () => {
    it('accepts valid url with default mode', () => {
      const res = FetchRequest.safeParse({ url: 'https://example.com' });
      expect(res.success).toBe(true);
      expect(res.data.url).toBe('https://example.com');
      expect(res.data.mode).toBe('fast');
    });

    it('accepts valid url with explicit fast mode', () => {
      const res = FetchRequest.safeParse({ url: 'https://example.com', mode: 'fast' });
      expect(res.success).toBe(true);
      expect(res.data.mode).toBe('fast');
    });

    it('accepts valid url with full mode', () => {
      const res = FetchRequest.safeParse({ url: 'https://example.com/page', mode: 'full' });
      expect(res.success).toBe(true);
      expect(res.data.mode).toBe('full');
    });

    it('accepts http urls', () => {
      const res = FetchRequest.safeParse({ url: 'http://example.com' });
      expect(res.success).toBe(true);
    });

    it('accepts urls with paths and query strings', () => {
      const res = FetchRequest.safeParse({ url: 'https://example.com/path?q=1&b=2#frag' });
      expect(res.success).toBe(true);
    });

    it('rejects missing url', () => {
      expect(FetchRequest.safeParse({}).success).toBe(false);
    });

    it('rejects empty string url', () => {
      expect(FetchRequest.safeParse({ url: '' }).success).toBe(false);
    });

    it('rejects non-url strings', () => {
      expect(FetchRequest.safeParse({ url: 'not-a-url' }).success).toBe(false);
    });

    it('rejects invalid mode', () => {
      expect(FetchRequest.safeParse({ url: 'https://example.com', mode: 'invalid' }).success).toBe(
        false,
      );
    });

    it('rejects non-object input', () => {
      expect(FetchRequest.safeParse(null).success).toBe(false);
      expect(FetchRequest.safeParse('string').success).toBe(false);
      expect(FetchRequest.safeParse(42).success).toBe(false);
    });

    it('strips unknown properties', () => {
      const res = FetchRequest.safeParse({ url: 'https://example.com', extra: 'field' });
      expect(res.success).toBe(true);
      expect(res.data).not.toHaveProperty('extra');
    });

    it('rejects url as number', () => {
      expect(FetchRequest.safeParse({ url: 123 }).success).toBe(false);
    });

    it('defaults mode when omitted', () => {
      const res = FetchRequest.safeParse({ url: 'https://example.com' });
      expect(res.success).toBe(true);
      expect(res.data.mode).toBe('fast');
    });
  });

  describe('FetchMetadata', () => {
    const validMeta = {
      url: 'https://example.com',
      fetchedAt: '2026-04-15T12:00:00Z',
      contentLength: 5000,
      truncated: false,
    };

    it('accepts valid metadata', () => {
      const res = FetchMetadata.safeParse(validMeta);
      expect(res.success).toBe(true);
      expect(res.data).toEqual(validMeta);
    });

    it('accepts zero contentLength', () => {
      const res = FetchMetadata.safeParse({ ...validMeta, contentLength: 0 });
      expect(res.success).toBe(true);
    });

    it('accepts truncated=true', () => {
      const res = FetchMetadata.safeParse({ ...validMeta, truncated: true });
      expect(res.success).toBe(true);
      expect(res.data.truncated).toBe(true);
    });

    it('rejects negative contentLength', () => {
      expect(FetchMetadata.safeParse({ ...validMeta, contentLength: -1 }).success).toBe(false);
    });

    it('rejects float contentLength', () => {
      expect(FetchMetadata.safeParse({ ...validMeta, contentLength: 1.5 }).success).toBe(false);
    });

    it('rejects invalid url', () => {
      expect(FetchMetadata.safeParse({ ...validMeta, url: 'not-a-url' }).success).toBe(false);
    });

    it('rejects missing url', () => {
      const { url: _url, ...rest } = validMeta;
      expect(FetchMetadata.safeParse(rest).success).toBe(false);
    });

    it('rejects invalid datetime for fetchedAt', () => {
      expect(FetchMetadata.safeParse({ ...validMeta, fetchedAt: 'yesterday' }).success).toBe(false);
    });

    it('rejects missing fetchedAt', () => {
      const { fetchedAt: _fetchedAt, ...rest } = validMeta;
      expect(FetchMetadata.safeParse(rest).success).toBe(false);
    });

    it('rejects non-boolean truncated', () => {
      expect(FetchMetadata.safeParse({ ...validMeta, truncated: 'no' }).success).toBe(false);
    });

    it('rejects non-number contentLength', () => {
      expect(FetchMetadata.safeParse({ ...validMeta, contentLength: '5000' }).success).toBe(false);
    });

    it('rejects non-object input', () => {
      expect(FetchMetadata.safeParse(null).success).toBe(false);
      expect(FetchMetadata.safeParse([]).success).toBe(false);
    });

    it('accepts datetime with milliseconds', () => {
      const res = FetchMetadata.safeParse({ ...validMeta, fetchedAt: '2026-04-15T12:00:00.123Z' });
      expect(res.success).toBe(true);
    });

    it('rejects datetime with timezone offset (UTC required)', () => {
      const res = FetchMetadata.safeParse({ ...validMeta, fetchedAt: '2026-04-15T12:00:00+05:00' });
      expect(res.success).toBe(false);
    });
  });

  describe('FetchResponse', () => {
    const validMeta = {
      url: 'https://example.com',
      fetchedAt: '2026-04-15T12:00:00Z',
      contentLength: 1234,
      truncated: false,
    };

    const validResponse = {
      title: 'Example Page',
      markdown: '# Hello\n\nSome content.',
      metadata: validMeta,
    };

    it('accepts valid response', () => {
      const res = FetchResponse.safeParse(validResponse);
      expect(res.success).toBe(true);
      expect(res.data.title).toBe('Example Page');
      expect(res.data.markdown).toBe('# Hello\n\nSome content.');
      expect(res.data.metadata).toEqual(validMeta);
    });

    it('accepts empty title', () => {
      const res = FetchResponse.safeParse({ ...validResponse, title: '' });
      expect(res.success).toBe(true);
    });

    it('accepts empty markdown', () => {
      const res = FetchResponse.safeParse({ ...validResponse, markdown: '' });
      expect(res.success).toBe(true);
    });

    it('rejects missing title', () => {
      const { title: _title, ...rest } = validResponse;
      expect(FetchResponse.safeParse(rest).success).toBe(false);
    });

    it('rejects missing markdown', () => {
      const { markdown: _md, ...rest } = validResponse;
      expect(FetchResponse.safeParse(rest).success).toBe(false);
    });

    it('rejects missing metadata', () => {
      const { metadata: _meta, ...rest } = validResponse;
      expect(FetchResponse.safeParse(rest).success).toBe(false);
    });

    it('rejects invalid metadata (missing url)', () => {
      const { url: _url, ...badMeta } = validMeta;
      expect(FetchResponse.safeParse({ ...validResponse, metadata: badMeta }).success).toBe(false);
    });

    it('rejects non-string title', () => {
      expect(FetchResponse.safeParse({ ...validResponse, title: 42 }).success).toBe(false);
    });

    it('rejects non-string markdown', () => {
      expect(FetchResponse.safeParse({ ...validResponse, markdown: null }).success).toBe(false);
    });

    it('rejects non-object input', () => {
      expect(FetchResponse.safeParse(null).success).toBe(false);
      expect(FetchResponse.safeParse('string').success).toBe(false);
    });

    it('strips unknown top-level properties', () => {
      const res = FetchResponse.safeParse({ ...validResponse, extra: true });
      expect(res.success).toBe(true);
      expect(res.data).not.toHaveProperty('extra');
    });
  });
});
