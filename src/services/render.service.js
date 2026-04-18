import { UpstreamError } from '../lib/errors.js';

const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS) || 15_000;
const RENDER_WAIT_UNTIL = process.env.RENDER_WAIT_UNTIL || 'networkidle';
const MAX_BODY_BYTES = Number(process.env.FETCH_MAX_BODY_BYTES) || 2 * 1024 * 1024;

let _browser = null;

async function getExecutablePath() {
  try {
    const chromium = await import('@sparticuz/chromium');
    return chromium.default.executablePath();
  } catch {
    return undefined;
  }
}

async function launchBrowser() {
  if (_browser?.isConnected()) return _browser;

  const { chromium } = await import('playwright-core');
  const executablePath = await getExecutablePath();

  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
    ],
  };

  if (executablePath) launchOpts.executablePath = executablePath;

  _browser = await chromium.launch(launchOpts);
  return _browser;
}

async function renderPage(url) {
  let browser;
  try {
    browser = await launchBrowser();
  } catch (err) {
    throw new UpstreamError('playwright', { reason: err.message, url });
  }

  const context = await browser.newContext({
    userAgent: 'BitBooth-Render/1.0',
    viewport: { width: 1280, height: 720 },
    javaScriptEnabled: true,
  });

  const page = await context.newPage();

  try {
    await page.goto(url, {
      waitUntil: RENDER_WAIT_UNTIL,
      timeout: RENDER_TIMEOUT_MS,
    });

    const html = await page.content();
    const title = await page.title();
    const contentLength = Buffer.byteLength(html, 'utf-8');
    const truncated = contentLength > MAX_BODY_BYTES;
    const finalHtml = truncated ? html.slice(0, MAX_BODY_BYTES) : html;

    return { html: finalHtml, title, contentLength, truncated };
  } catch (err) {
    throw new UpstreamError('playwright', { reason: err.message, url });
  } finally {
    await context.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

export const renderService = { renderPage, closeBrowser };

/** @internal — exposed for testing only */
export function _resetBrowser() {
  _browser = null;
}
