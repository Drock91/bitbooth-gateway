import { describe, it, expect } from 'vitest';
import { FETCH_HTML } from '../../src/static/fetch.html.js';
import { FETCH_CSS } from '../../src/static/fetch.css.js';

describe('fetch.html.js', () => {
  describe('FETCH_HTML export', () => {
    it('is a non-empty string', () => {
      expect(typeof FETCH_HTML).toBe('string');
      expect(FETCH_HTML.length).toBeGreaterThan(100);
    });

    it('is valid HTML with doctype and lang', () => {
      expect(FETCH_HTML).toMatch(/^<!doctype html>/);
      expect(FETCH_HTML).toContain('<html lang="en">');
      expect(FETCH_HTML).toContain('</html>');
    });

    it('sets charset and viewport meta', () => {
      expect(FETCH_HTML).toContain('charset="utf-8"');
      expect(FETCH_HTML).toContain('width=device-width');
    });

    it('contains the hero tagline', () => {
      expect(FETCH_HTML).toContain('Pay-per-scrape for AI');
      expect(FETCH_HTML).toContain('$0.005 per fetch');
    });

    it('mentions x402 protocol', () => {
      expect(FETCH_HTML).toContain('x402');
      expect(FETCH_HTML).toContain('https://www.x402.org');
    });

    it('contains the bitbooth brand', () => {
      expect(FETCH_HTML).toContain('bitbooth');
    });
  });

  describe('navigation', () => {
    it('links to home, docs, and dashboard', () => {
      expect(FETCH_HTML).toContain('href="/"');
      expect(FETCH_HTML).toContain('href="/docs"');
      expect(FETCH_HTML).toContain('href="/dashboard"');
    });
  });

  describe('interactive demo', () => {
    it('has a demo section with id', () => {
      expect(FETCH_HTML).toContain('id="demo"');
    });

    it('contains demo URL input', () => {
      expect(FETCH_HTML).toContain('id="demo-url"');
      expect(FETCH_HTML).toContain('type="text"');
    });

    it('contains demo output area with ARIA live region', () => {
      expect(FETCH_HTML).toContain('id="demo-output"');
      expect(FETCH_HTML).toContain('role="log"');
      expect(FETCH_HTML).toContain('aria-live="polite"');
    });

    it('contains demo run button', () => {
      expect(FETCH_HTML).toContain('id="demo-btn"');
      expect(FETCH_HTML).toContain('runDemo()');
    });

    it('demo script shows 402 challenge flow', () => {
      expect(FETCH_HTML).toContain('402 Payment Required');
      expect(FETCH_HTML).toContain('X-PAYMENT');
      expect(FETCH_HTML).toContain('HTTP 200 OK');
    });
  });

  describe('code snippets', () => {
    it('has tab buttons for all 6 SDKs', () => {
      expect(FETCH_HTML).toContain('data-tab="curl"');
      expect(FETCH_HTML).toContain('data-tab="js"');
      expect(FETCH_HTML).toContain('data-tab="python"');
      expect(FETCH_HTML).toContain('data-tab="langchain"');
      expect(FETCH_HTML).toContain('data-tab="crewai"');
      expect(FETCH_HTML).toContain('data-tab="claude"');
    });

    it('has matching tab panels', () => {
      expect(FETCH_HTML).toContain('data-panel="curl"');
      expect(FETCH_HTML).toContain('data-panel="js"');
      expect(FETCH_HTML).toContain('data-panel="python"');
      expect(FETCH_HTML).toContain('data-panel="langchain"');
      expect(FETCH_HTML).toContain('data-panel="crewai"');
      expect(FETCH_HTML).toContain('data-panel="claude"');
    });

    it('curl tab is active by default', () => {
      expect(FETCH_HTML).toMatch(/data-tab="curl"[^>]*>curl<\/button>/);
      expect(FETCH_HTML).toContain('data-panel="curl"');
    });

    it('curl snippet shows POST /v1/fetch', () => {
      expect(FETCH_HTML).toContain('POST https://api.bitbooth.io/v1/fetch');
    });

    it('JavaScript snippet imports BitBoothClient', () => {
      expect(FETCH_HTML).toContain('@bitbooth/sdk');
      expect(FETCH_HTML).toContain('BitBoothClient');
    });

    it('Python snippet uses bitbooth package', () => {
      expect(FETCH_HTML).toContain('bitbooth');
      expect(FETCH_HTML).toContain('BitBoothClient');
    });

    it('LangChain snippet shows tool integration', () => {
      expect(FETCH_HTML).toContain('BitBoothFetchTool');
      expect(FETCH_HTML).toContain('initialize_agent');
    });

    it('crewAI snippet shows Agent and Crew', () => {
      expect(FETCH_HTML).toContain('crewai');
      expect(FETCH_HTML).toContain('Agent');
      expect(FETCH_HTML).toContain('Crew');
    });

    it('Claude Agent SDK snippet shows MCP config', () => {
      expect(FETCH_HTML).toContain('@bitbooth/mcp-fetch');
      expect(FETCH_HTML).toContain('mcpServers');
      expect(FETCH_HTML).toContain('BITBOOTH_AGENT_KEY');
    });

    it('switchTab function is included', () => {
      expect(FETCH_HTML).toContain('function switchTab');
    });
  });

  describe('features section', () => {
    it('lists multi-chain support', () => {
      expect(FETCH_HTML).toContain('Multi-chain');
      expect(FETCH_HTML).toContain('Base');
      expect(FETCH_HTML).toContain('Solana');
    });

    it('lists no API keys for payment', () => {
      expect(FETCH_HTML).toContain('No API keys for payment');
    });

    it('lists clean markdown output', () => {
      expect(FETCH_HTML).toContain('Clean markdown');
      expect(FETCH_HTML).toContain('Readability');
    });

    it('lists 2-block confirmation', () => {
      expect(FETCH_HTML).toContain('2-block confirmation');
    });
  });

  describe('pricing section', () => {
    it('shows $0.005 per fetch price', () => {
      expect(FETCH_HTML).toContain('$0.005');
    });

    it('highlights pay-per-request model', () => {
      expect(FETCH_HTML).toContain('Pay per request');
      expect(FETCH_HTML).toContain('No minimum commitment');
      expect(FETCH_HTML).toContain('No monthly subscription');
    });

    it('mentions volume discounts', () => {
      expect(FETCH_HTML).toContain('Volume discounts');
    });
  });

  describe('footer', () => {
    it('references x402 protocol', () => {
      expect(FETCH_HTML).toContain('github.com/coinbase/x402');
    });

    it('mentions Base + Solana settlement', () => {
      expect(FETCH_HTML).toContain('Base + Solana');
    });
  });

  describe('SEO', () => {
    it('has descriptive title', () => {
      expect(FETCH_HTML).toContain('<title>BitBooth Fetch');
      expect(FETCH_HTML).toContain('Pay-per-scrape');
    });

    it('has meta description', () => {
      expect(FETCH_HTML).toContain('name="description"');
      expect(FETCH_HTML).toContain('$0.005 USDC');
    });
  });
});

describe('fetch.css.js', () => {
  it('exports FETCH_CSS as a non-empty string', () => {
    expect(typeof FETCH_CSS).toBe('string');
    expect(FETCH_CSS.length).toBeGreaterThan(100);
  });

  it('includes theme tokens', () => {
    expect(FETCH_CSS).toContain('--bg:');
    expect(FETCH_CSS).toContain('--accent:');
    expect(FETCH_CSS).toContain('--font-sans:');
  });

  it('includes theme base styles', () => {
    expect(FETCH_CSS).toContain('box-sizing: border-box');
    expect(FETCH_CSS).toContain('.btn-primary');
  });

  it('includes fetch-specific overrides', () => {
    expect(FETCH_CSS).toContain('.demo-box');
    expect(FETCH_CSS).toContain('.demo-output');
    expect(FETCH_CSS).toContain('.price-pill');
    expect(FETCH_CSS).toContain('.features');
    expect(FETCH_CSS).toContain('.pricing-table');
  });

  it('includes tab styles', () => {
    expect(FETCH_CSS).toContain('.tabs');
    expect(FETCH_CSS).toContain('.tab.active');
    expect(FETCH_CSS).toContain('.tab-panel');
  });

  it('includes mobile breakpoint', () => {
    expect(FETCH_CSS).toContain('@media (max-width: 600px)');
  });
});
