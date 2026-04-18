import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { fetchWithTimeout } from '../lib/http.js';
import { UpstreamError, ValidationError } from '../lib/errors.js';
import { renderService } from './render.service.js';

const MAX_BODY_BYTES = Number(process.env.FETCH_MAX_BODY_BYTES) || 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 10_000;

function buildTurndown() {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  td.remove(['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header']);
  return td;
}

async function readBody(res) {
  const chunks = [];
  let bytes = 0;
  const reader = res.body.getReader();
  let truncated = false;

  /* eslint-disable no-constant-condition */
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > MAX_BODY_BYTES) {
      truncated = true;
      const excess = bytes - MAX_BODY_BYTES;
      chunks.push(value.slice(0, value.length - excess));
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }

  const buf = Buffer.concat(chunks);
  return { html: buf.toString('utf-8'), contentLength: bytes, truncated };
}

function extractArticle(html, url) {
  // linkedom is a lightweight DOM implementation without jsdom's static-asset
  // dependencies (jsdom's /browser/default-stylesheet.css broke the esbuild
  // bundle — ENOENT at Lambda cold start). linkedom is API-compatible with
  // what @mozilla/readability needs.
  const { document } = parseHTML(html);
  // Readability also reads documentURI to resolve relative URLs; set it so
  // links in the extracted markdown aren't broken.
  try {
    Object.defineProperty(document, 'documentURI', { value: url, configurable: true });
    Object.defineProperty(document, 'baseURI', { value: url, configurable: true });
  } catch (_) {
    // linkedom sometimes has these as non-configurable accessor props; if
    // the defineProperty fails, Readability still works with relative URLs
    // (they just won't be resolved to absolute). Non-fatal.
  }
  const reader = new Readability(document);
  const article = reader.parse();
  if (!article) {
    return { title: '', content: html };
  }
  return { title: article.title || '', content: article.content };
}

async function fetchHtml(url) {
  let res;
  try {
    res = await fetchWithTimeout(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      retry: { retries: 0 },
      headers: {
        'User-Agent': 'BitBooth-Fetch/1.0',
        Accept: 'text/html, application/xhtml+xml',
      },
    });
  } catch (err) {
    throw new UpstreamError('fetch', { reason: err.message, url });
  }

  if (!res.ok) {
    throw new UpstreamError('fetch', {
      reason: `HTTP ${res.status}`,
      url,
      status: res.status,
    });
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('text/html') && !ct.includes('application/xhtml+xml')) {
    throw new ValidationError([{ path: ['url'], message: `Non-HTML content-type: ${ct}` }]);
  }

  return readBody(res);
}

export const fetchService = {
  async fetch({ url, mode }) {
    if (mode === 'render') {
      const rendered = await renderService.renderPage(url);
      const article = extractArticle(rendered.html, url);
      const td = buildTurndown();
      const markdown = td.turndown(article.content);
      return {
        title: rendered.title || article.title,
        markdown,
        metadata: {
          url,
          fetchedAt: new Date().toISOString(),
          contentLength: rendered.contentLength,
          truncated: rendered.truncated,
        },
      };
    }

    const { html, contentLength, truncated } = await fetchHtml(url);

    let title, markdown;
    if (mode === 'fast') {
      const td = buildTurndown();
      title = '';
      markdown = td.turndown(html);
    } else {
      const article = extractArticle(html, url);
      title = article.title;
      const td = buildTurndown();
      markdown = td.turndown(article.content);
    }

    return {
      title,
      markdown,
      metadata: {
        url,
        fetchedAt: new Date().toISOString(),
        contentLength,
        truncated,
      },
    };
  },
};
