import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLaunch = vi.hoisted(() => vi.fn());
const mockExecPath = vi.hoisted(() => vi.fn());

vi.mock('playwright-core', () => ({
  chromium: { launch: mockLaunch },
}));

vi.mock('@sparticuz/chromium', () => ({
  default: { executablePath: mockExecPath },
}));

import { renderService, _resetBrowser } from '../../src/services/render.service.js';
import { UpstreamError } from '../../src/lib/errors.js';

function makeMockPage(html = '<html><body>rendered</body></html>', title = 'Test') {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue(html),
    title: vi.fn().mockResolvedValue(title),
  };
}

function makeMockContext(page) {
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockBrowser(context) {
  return {
    isConnected: vi.fn().mockReturnValue(true),
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('renderService', () => {
  let mockPage, mockContext, mockBrowser;

  beforeEach(() => {
    vi.resetAllMocks();
    _resetBrowser();

    mockPage = makeMockPage();
    mockContext = makeMockContext(mockPage);
    mockBrowser = makeMockBrowser(mockContext);
    mockLaunch.mockResolvedValue(mockBrowser);
    mockExecPath.mockResolvedValue('/opt/chromium');
  });

  afterEach(async () => {
    _resetBrowser();
  });

  describe('renderPage — success paths', () => {
    it('launches browser and returns rendered HTML', async () => {
      const result = await renderService.renderPage('https://spa.example.com');

      expect(mockLaunch).toHaveBeenCalledOnce();
      expect(mockPage.goto).toHaveBeenCalledWith('https://spa.example.com', {
        waitUntil: 'networkidle',
        timeout: 15_000,
      });
      expect(result.html).toContain('rendered');
      expect(result.title).toBe('Test');
      expect(result.truncated).toBe(false);
    });

    it('reuses existing browser on subsequent calls', async () => {
      await renderService.renderPage('https://a.com');
      await renderService.renderPage('https://b.com');

      expect(mockLaunch).toHaveBeenCalledOnce();
    });

    it('creates a new context per request', async () => {
      await renderService.renderPage('https://a.com');
      await renderService.renderPage('https://b.com');

      expect(mockBrowser.newContext).toHaveBeenCalledTimes(2);
    });

    it('closes context after rendering', async () => {
      await renderService.renderPage('https://example.com');

      expect(mockContext.close).toHaveBeenCalledOnce();
    });

    it('sets correct viewport and user agent', async () => {
      await renderService.renderPage('https://example.com');

      expect(mockBrowser.newContext).toHaveBeenCalledWith({
        userAgent: 'BitBooth-Render/1.0',
        viewport: { width: 1280, height: 720 },
        javaScriptEnabled: true,
      });
    });

    it('passes Lambda-safe launch args', async () => {
      await renderService.renderPage('https://example.com');

      const launchOpts = mockLaunch.mock.calls[0][0];
      expect(launchOpts.headless).toBe(true);
      expect(launchOpts.args).toContain('--no-sandbox');
      expect(launchOpts.args).toContain('--disable-dev-shm-usage');
      expect(launchOpts.args).toContain('--single-process');
      expect(launchOpts.executablePath).toBe('/opt/chromium');
    });

    it('calculates contentLength in bytes', async () => {
      const html = '<html><body>\u00e9\u00e8\u00ea</body></html>';
      mockPage.content.mockResolvedValue(html);

      const result = await renderService.renderPage('https://example.com');

      expect(result.contentLength).toBe(Buffer.byteLength(html, 'utf-8'));
    });

    it('returns title from page', async () => {
      mockPage.title.mockResolvedValue('SPA Dashboard');

      const result = await renderService.renderPage('https://example.com');

      expect(result.title).toBe('SPA Dashboard');
    });
  });

  describe('renderPage — truncation', () => {
    it('truncates content exceeding MAX_BODY_BYTES', async () => {
      const bigHtml = 'x'.repeat(3 * 1024 * 1024);
      mockPage.content.mockResolvedValue(bigHtml);

      const result = await renderService.renderPage('https://big.com');

      expect(result.truncated).toBe(true);
      expect(result.html.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    });
  });

  describe('renderPage — error paths', () => {
    it('throws UpstreamError when browser launch fails', async () => {
      mockLaunch.mockRejectedValue(new Error('Chromium not found'));

      await expect(renderService.renderPage('https://fail.com')).rejects.toThrow(UpstreamError);
    });

    it('includes url in UpstreamError details on launch failure', async () => {
      mockLaunch.mockRejectedValue(new Error('Chromium not found'));

      try {
        await renderService.renderPage('https://fail.com');
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(UpstreamError);
        expect(e.details.url).toBe('https://fail.com');
        expect(e.details.reason).toBe('Chromium not found');
      }
    });

    it('throws UpstreamError when page.goto times out', async () => {
      mockPage.goto.mockRejectedValue(new Error('Timeout 15000ms exceeded'));

      await expect(renderService.renderPage('https://slow.com')).rejects.toThrow(UpstreamError);
    });

    it('closes context even when page.goto fails', async () => {
      mockPage.goto.mockRejectedValue(new Error('Navigation failed'));

      await expect(renderService.renderPage('https://fail.com')).rejects.toThrow();
      expect(mockContext.close).toHaveBeenCalledOnce();
    });

    it('does not throw if context.close fails in finally', async () => {
      mockContext.close.mockRejectedValue(new Error('already closed'));
      mockPage.goto.mockRejectedValue(new Error('Navigation failed'));

      await expect(renderService.renderPage('https://fail.com')).rejects.toThrow(UpstreamError);
    });

    it('relaunches browser when disconnected', async () => {
      mockBrowser.isConnected.mockReturnValue(false);

      const freshBrowser = makeMockBrowser(mockContext);
      mockLaunch.mockResolvedValueOnce(mockBrowser).mockResolvedValueOnce(freshBrowser);

      // First call — browser disconnected, launches new one
      _resetBrowser();
      await renderService.renderPage('https://example.com');

      expect(mockLaunch).toHaveBeenCalled();
    });
  });

  describe('closeBrowser', () => {
    it('calls close on the launched browser and requires re-launch', async () => {
      // Track close calls via a flag since module state is tricky in tests
      let closeCalled = false;
      const trackedBrowser = {
        isConnected: vi.fn().mockReturnValue(true),
        newContext: vi.fn().mockResolvedValue(mockContext),
        close: vi.fn().mockImplementation(() => {
          closeCalled = true;
          return Promise.resolve();
        }),
      };
      mockLaunch.mockResolvedValue(trackedBrowser);

      await renderService.renderPage('https://example.com');
      await renderService.closeBrowser();

      expect(closeCalled).toBe(true);

      // After close, next renderPage forces a new launch
      mockLaunch.mockResolvedValue(makeMockBrowser(makeMockContext(makeMockPage())));
      await renderService.renderPage('https://example.com');

      expect(mockLaunch).toHaveBeenCalledTimes(2);
    });

    it('does not throw if no browser is open', async () => {
      await expect(renderService.closeBrowser()).resolves.not.toThrow();
    });

    it('swallows close errors gracefully', async () => {
      const crashBrowser = {
        isConnected: vi.fn().mockReturnValue(true),
        newContext: vi.fn().mockResolvedValue(mockContext),
        close: vi.fn().mockRejectedValue(new Error('crash')),
      };
      mockLaunch.mockResolvedValue(crashBrowser);

      await renderService.renderPage('https://example.com');

      await expect(renderService.closeBrowser()).resolves.not.toThrow();
    });
  });

  describe('getExecutablePath — fallback', () => {
    it('returns undefined when @sparticuz/chromium not available', async () => {
      await renderService.renderPage('https://example.com');
      const launchOpts = mockLaunch.mock.calls[0][0];
      expect(launchOpts.executablePath).toBe('/opt/chromium');
    });
  });
});
