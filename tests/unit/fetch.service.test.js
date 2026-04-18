import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetchWithTimeout = vi.hoisted(() => vi.fn());
const mockRenderPage = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/http.js', () => ({
  fetchWithTimeout: mockFetchWithTimeout,
}));

vi.mock('../../src/services/render.service.js', () => ({
  renderService: { renderPage: mockRenderPage, closeBrowser: vi.fn() },
}));

import { fetchService } from '../../src/services/fetch.service.js';
import { UpstreamError, ValidationError } from '../../src/lib/errors.js';

function makeHeaders(ct) {
  return { get: (k) => (k === 'content-type' ? ct : null) };
}

function mockRes(body, ct = 'text/html; charset=utf-8', ok = true, status = 200) {
  const encoded = new TextEncoder().encode(body);
  let done = false;
  return {
    ok,
    status,
    headers: makeHeaders(ct),
    body: {
      getReader() {
        return {
          async read() {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: encoded };
          },
          async cancel() {},
        };
      },
    },
  };
}

const SIMPLE_HTML = `<!DOCTYPE html><html><head><title>Test Page</title></head>
<body><h1>Hello World</h1><p>Some content here.</p></body></html>`;

const ARTICLE_HTML = `<!DOCTYPE html><html><head><title>Article Title</title></head>
<body>
<article>
<h1>Article Title</h1>
<p>This is a well-structured article with enough text content for Readability to parse it properly.
It needs to be substantial enough that the readability algorithm considers it a real article rather
than boilerplate. Adding more text here to ensure the parser picks it up correctly.</p>
<p>Another paragraph of substantial content to give the readability algorithm something to work with.
The more text we have, the more likely it is that the parser will identify this as the main content.</p>
</article>
</body></html>`;

describe('fetchService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('fetch — success paths', () => {
    it('returns markdown in fast mode', async () => {
      mockFetchWithTimeout.mockResolvedValue(mockRes(SIMPLE_HTML));

      const result = await fetchService.fetch({
        url: 'https://example.com',
        mode: 'fast',
      });

      expect(result.markdown).toContain('Hello World');
      expect(result.markdown).toContain('Some content here');
      expect(result.title).toBe('');
      expect(result.metadata.url).toBe('https://example.com');
      expect(result.metadata.truncated).toBe(false);
      expect(result.metadata.contentLength).toBeGreaterThan(0);
      expect(result.metadata.fetchedAt).toBeTruthy();
    });

    it('extracts title and article content in full mode', async () => {
      mockFetchWithTimeout.mockResolvedValue(mockRes(ARTICLE_HTML));

      const result = await fetchService.fetch({
        url: 'https://example.com/article',
        mode: 'full',
      });

      expect(result.markdown).toContain('well-structured article');
      expect(result.metadata.url).toBe('https://example.com/article');
      expect(result.metadata.truncated).toBe(false);
    });

    it('accepts application/xhtml+xml content-type', async () => {
      mockFetchWithTimeout.mockResolvedValue(mockRes(SIMPLE_HTML, 'application/xhtml+xml'));

      const result = await fetchService.fetch({
        url: 'https://example.com',
        mode: 'fast',
      });

      expect(result.markdown).toContain('Hello World');
    });

    it('strips script and style tags', async () => {
      const html = `<html><head><title>T</title></head><body>
        <script>alert('xss')</script>
        <style>.x{color:red}</style>
        <p>Clean content</p>
      </body></html>`;
      mockFetchWithTimeout.mockResolvedValue(mockRes(html));

      const result = await fetchService.fetch({
        url: 'https://example.com',
        mode: 'fast',
      });

      expect(result.markdown).not.toContain('alert');
      expect(result.markdown).not.toContain('color:red');
      expect(result.markdown).toContain('Clean content');
    });

    it('preserves links in markdown output', async () => {
      const html = `<html><head><title>T</title></head><body>
        <p>Visit <a href="https://example.com">our site</a></p>
      </body></html>`;
      mockFetchWithTimeout.mockResolvedValue(mockRes(html));

      const result = await fetchService.fetch({
        url: 'https://example.com',
        mode: 'fast',
      });

      expect(result.markdown).toContain('[our site](https://example.com)');
    });

    it('passes correct options to fetchWithTimeout', async () => {
      mockFetchWithTimeout.mockResolvedValue(mockRes(SIMPLE_HTML));

      await fetchService.fetch({ url: 'https://x.com', mode: 'fast' });

      expect(mockFetchWithTimeout).toHaveBeenCalledWith('https://x.com', {
        timeoutMs: 10_000,
        retry: { retries: 0 },
        headers: {
          'User-Agent': 'BitBooth-Fetch/1.0',
          Accept: 'text/html, application/xhtml+xml',
        },
      });
    });
  });

  describe('fetch — error paths', () => {
    it('throws UpstreamError when fetch rejects', async () => {
      mockFetchWithTimeout.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(fetchService.fetch({ url: 'https://down.com', mode: 'fast' })).rejects.toThrow(
        UpstreamError,
      );
    });

    it('includes url in UpstreamError details on fetch reject', async () => {
      mockFetchWithTimeout.mockRejectedValue(new Error('network'));

      try {
        await fetchService.fetch({ url: 'https://bad.com', mode: 'fast' });
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(UpstreamError);
        expect(e.details.url).toBe('https://bad.com');
        expect(e.details.reason).toBe('network');
      }
    });

    it('throws UpstreamError on non-ok HTTP status', async () => {
      mockFetchWithTimeout.mockResolvedValue(mockRes('', 'text/html', false, 404));

      try {
        await fetchService.fetch({ url: 'https://miss.com', mode: 'fast' });
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(UpstreamError);
        expect(e.details.reason).toBe('HTTP 404');
        expect(e.details.status).toBe(404);
      }
    });

    it('throws ValidationError on non-HTML content-type', async () => {
      mockFetchWithTimeout.mockResolvedValue(mockRes('{}', 'application/json', true, 200));

      await expect(
        fetchService.fetch({ url: 'https://api.com/data', mode: 'fast' }),
      ).rejects.toThrow(ValidationError);
    });

    it('includes content-type in ValidationError details', async () => {
      mockFetchWithTimeout.mockResolvedValue(mockRes('binary', 'application/pdf', true, 200));

      try {
        await fetchService.fetch({ url: 'https://x.com/doc', mode: 'fast' });
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect(e.details[0].message).toContain('application/pdf');
      }
    });

    it('throws ValidationError when content-type header is empty', async () => {
      mockFetchWithTimeout.mockResolvedValue(mockRes('data', '', true, 200));

      await expect(fetchService.fetch({ url: 'https://x.com', mode: 'fast' })).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe('fetch — body size cap', () => {
    it('truncates body exceeding 2MB', async () => {
      const bigChunk = new Uint8Array(3 * 1024 * 1024).fill(65);
      let readerDone = false;
      const res = {
        ok: true,
        status: 200,
        headers: makeHeaders('text/html'),
        body: {
          getReader() {
            return {
              async read() {
                if (readerDone) return { done: true, value: undefined };
                readerDone = true;
                return { done: false, value: bigChunk };
              },
              async cancel() {},
            };
          },
        },
      };
      mockFetchWithTimeout.mockResolvedValue(res);

      const result = await fetchService.fetch({
        url: 'https://big.com',
        mode: 'fast',
      });

      expect(result.metadata.truncated).toBe(true);
      expect(result.metadata.contentLength).toBe(3 * 1024 * 1024);
    });

    it('streams multiple chunks and respects cap', async () => {
      const chunkSize = 1024 * 1024;
      let callCount = 0;
      const res = {
        ok: true,
        status: 200,
        headers: makeHeaders('text/html'),
        body: {
          getReader() {
            return {
              async read() {
                if (callCount >= 3) return { done: true, value: undefined };
                callCount++;
                return {
                  done: false,
                  value: new Uint8Array(chunkSize).fill(66),
                };
              },
              async cancel() {},
            };
          },
        },
      };
      mockFetchWithTimeout.mockResolvedValue(res);

      const result = await fetchService.fetch({
        url: 'https://stream.com',
        mode: 'fast',
      });

      expect(result.metadata.truncated).toBe(true);
    });

    it('does not truncate body under 2MB', async () => {
      const small = '<html><body><p>Hi</p></body></html>';
      mockFetchWithTimeout.mockResolvedValue(mockRes(small));

      const result = await fetchService.fetch({
        url: 'https://small.com',
        mode: 'fast',
      });

      expect(result.metadata.truncated).toBe(false);
    });
  });

  describe('fetch — full mode Readability fallback', () => {
    it('falls back to raw HTML when Readability returns null', async () => {
      const minimal = '<html><body><span>tiny</span></body></html>';
      mockFetchWithTimeout.mockResolvedValue(mockRes(minimal));

      const result = await fetchService.fetch({
        url: 'https://min.com',
        mode: 'full',
      });

      expect(result.title).toBe('');
      expect(result.markdown).toContain('tiny');
    });
  });

  describe('fetch — metadata shape', () => {
    it('returns ISO datetime in fetchedAt', async () => {
      mockFetchWithTimeout.mockResolvedValue(mockRes(SIMPLE_HTML));

      const result = await fetchService.fetch({
        url: 'https://example.com',
        mode: 'fast',
      });

      expect(() => new Date(result.metadata.fetchedAt)).not.toThrow();
      expect(new Date(result.metadata.fetchedAt).toISOString()).toBe(result.metadata.fetchedAt);
    });

    it('contentLength matches actual bytes received', async () => {
      const body = '<html><body>Hello</body></html>';
      mockFetchWithTimeout.mockResolvedValue(mockRes(body));

      const result = await fetchService.fetch({
        url: 'https://example.com',
        mode: 'fast',
      });

      const expected = new TextEncoder().encode(body).length;
      expect(result.metadata.contentLength).toBe(expected);
    });
  });

  describe('fetch — render mode', () => {
    it('delegates to renderService.renderPage', async () => {
      mockRenderPage.mockResolvedValue({
        html: '<html><body><h1>SPA Content</h1><p>Dynamic data loaded via JS.</p></body></html>',
        title: 'SPA Dashboard',
        contentLength: 100,
        truncated: false,
      });

      const result = await fetchService.fetch({
        url: 'https://spa.example.com',
        mode: 'render',
      });

      expect(mockRenderPage).toHaveBeenCalledWith('https://spa.example.com');
      expect(result.markdown).toContain('SPA Content');
      expect(result.title).toBe('SPA Dashboard');
      expect(result.metadata.url).toBe('https://spa.example.com');
      expect(result.metadata.truncated).toBe(false);
    });

    it('does not call fetchWithTimeout in render mode', async () => {
      mockRenderPage.mockResolvedValue({
        html: '<html><body>ok</body></html>',
        title: '',
        contentLength: 30,
        truncated: false,
      });

      await fetchService.fetch({ url: 'https://spa.com', mode: 'render' });

      expect(mockFetchWithTimeout).not.toHaveBeenCalled();
    });

    it('extracts article from rendered HTML via Readability', async () => {
      const richHtml = `<html><head><title>T</title></head><body>
        <article><h1>Deep Render</h1>
        <p>This is substantial article content that Readability should extract.
        It has enough text to be recognized as the main content block.
        Additional paragraphs help the algorithm identify this as an article.</p>
        <p>Second paragraph with more content to meet the Readability threshold.</p>
        </article></body></html>`;
      mockRenderPage.mockResolvedValue({
        html: richHtml,
        title: 'Page Title',
        contentLength: Buffer.byteLength(richHtml),
        truncated: false,
      });

      const result = await fetchService.fetch({
        url: 'https://rich.com',
        mode: 'render',
      });

      expect(result.markdown).toContain('Deep Render');
    });

    it('prefers rendered page title over article title', async () => {
      mockRenderPage.mockResolvedValue({
        html: '<html><body><p>text</p></body></html>',
        title: 'Rendered Title',
        contentLength: 40,
        truncated: false,
      });

      const result = await fetchService.fetch({
        url: 'https://x.com',
        mode: 'render',
      });

      expect(result.title).toBe('Rendered Title');
    });

    it('falls back to article title when page title is empty', async () => {
      const html = `<html><head><title>Article T</title></head><body>
        <article><h1>Article T</h1>
        <p>Enough content for Readability to extract this as a real article.
        Multiple sentences needed for the algorithm to work properly here.</p>
        <p>Another paragraph to help readability detection.</p>
        </article></body></html>`;
      mockRenderPage.mockResolvedValue({
        html,
        title: '',
        contentLength: Buffer.byteLength(html),
        truncated: false,
      });

      const result = await fetchService.fetch({
        url: 'https://x.com',
        mode: 'render',
      });

      // Falls back to article.title when rendered.title is empty
      expect(result.title).toBeTruthy();
    });

    it('propagates UpstreamError from renderService', async () => {
      mockRenderPage.mockRejectedValue(
        new UpstreamError('playwright', { reason: 'timeout', url: 'https://slow.com' }),
      );

      await expect(fetchService.fetch({ url: 'https://slow.com', mode: 'render' })).rejects.toThrow(
        UpstreamError,
      );
    });

    it('passes truncated flag from renderService', async () => {
      mockRenderPage.mockResolvedValue({
        html: '<html><body>big</body></html>',
        title: '',
        contentLength: 3 * 1024 * 1024,
        truncated: true,
      });

      const result = await fetchService.fetch({
        url: 'https://big.com',
        mode: 'render',
      });

      expect(result.metadata.truncated).toBe(true);
      expect(result.metadata.contentLength).toBe(3 * 1024 * 1024);
    });
  });

  describe('fetch — turndown options', () => {
    it('converts headings to ATX style', async () => {
      const html =
        '<html><head><title>T</title></head><body><h2>Sub heading</h2><p>text</p></body></html>';
      mockFetchWithTimeout.mockResolvedValue(mockRes(html));

      const result = await fetchService.fetch({
        url: 'https://x.com',
        mode: 'fast',
      });

      expect(result.markdown).toContain('## Sub heading');
    });

    it('strips nav, footer, header, iframe, noscript elements', async () => {
      const html = `<html><head><title>T</title></head><body>
        <nav>Navigation</nav>
        <header>Header content</header>
        <main><p>Main content</p></main>
        <footer>Footer content</footer>
        <noscript>No JS</noscript>
        <iframe src="x"></iframe>
      </body></html>`;
      mockFetchWithTimeout.mockResolvedValue(mockRes(html));

      const result = await fetchService.fetch({
        url: 'https://x.com',
        mode: 'fast',
      });

      expect(result.markdown).toContain('Main content');
      expect(result.markdown).not.toContain('Navigation');
      expect(result.markdown).not.toContain('Footer content');
      expect(result.markdown).not.toContain('Header content');
      expect(result.markdown).not.toContain('No JS');
    });
  });
});
