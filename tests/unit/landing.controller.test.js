import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/load-openapi.js', () => ({
  loadOpenapiYaml: () => 'openapi: 3.0.3\ninfo:\n  title: test\npaths: {}\n',
}));

import {
  getLanding,
  getFetch,
  getDocs,
  getOpenapiYaml,
} from '../../src/controllers/landing.controller.js';

describe('landing.controller', () => {
  describe('getLanding', () => {
    it('returns 200 with HTML content-type', async () => {
      const res = await getLanding();
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    });

    it('contains obol brand name and tagline', async () => {
      const res = await getLanding();
      expect(res.body).toContain('obol');
      expect(res.body).toContain('Stripe for AI agents');
    });

    it('includes demo signup form', async () => {
      const res = await getLanding();
      expect(res.body).toContain('id="demo"');
      expect(res.body).toContain('type="email"');
      expect(res.body).toContain('/demo/signup');
    });

    it('includes links to /docs and /dashboard', async () => {
      const res = await getLanding();
      expect(res.body).toContain('href="/docs"');
      expect(res.body).toContain('href="/dashboard"');
    });

    it('sets strict CSP allowing only inline script/style', async () => {
      const res = await getLanding();
      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'unsafe-inline'");
      expect(csp).toContain("style-src 'unsafe-inline'");
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('sets x-content-type-options nosniff', async () => {
      const res = await getLanding();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('sets public cache-control for edge caching', async () => {
      const res = await getLanding();
      expect(res.headers['cache-control']).toContain('public');
    });

    it('lists all three pricing tiers', async () => {
      const res = await getLanding();
      expect(res.body).toContain('$49/mo');
      expect(res.body).toContain('$99/mo');
      expect(res.body).toContain('$299/mo');
    });
  });

  describe('getFetch', () => {
    it('returns 200 with HTML content-type', async () => {
      const res = await getFetch();
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    });

    it('contains BitBooth Fetch branding and tagline', async () => {
      const res = await getFetch();
      expect(res.body).toContain('bitbooth');
      expect(res.body).toContain('Pay-per-scrape');
    });

    it('contains interactive demo section', async () => {
      const res = await getFetch();
      expect(res.body).toContain('id="demo"');
      expect(res.body).toContain('runDemo');
    });

    it('contains SDK code snippets', async () => {
      const res = await getFetch();
      expect(res.body).toContain('LangChain');
      expect(res.body).toContain('crewAI');
      expect(res.body).toContain('@bitbooth/mcp-fetch');
    });

    it('shows $0.005 pricing', async () => {
      const res = await getFetch();
      expect(res.body).toContain('$0.005');
    });

    it('sets strict CSP same as landing page', async () => {
      const res = await getFetch();
      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'unsafe-inline'");
      expect(csp).toContain("style-src 'unsafe-inline'");
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('sets nosniff and no-referrer headers', async () => {
      const res = await getFetch();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    });

    it('sets public cache-control', async () => {
      const res = await getFetch();
      expect(res.headers['cache-control']).toContain('public');
    });
  });

  describe('getDocs', () => {
    it('returns 200 with HTML content-type', async () => {
      const res = await getDocs();
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    });

    it('loads swagger-ui from unpkg CDN', async () => {
      const res = await getDocs();
      expect(res.body).toContain('unpkg.com/swagger-ui-dist');
      expect(res.body).toContain('swagger-ui-bundle.js');
    });

    it('points swagger at /openapi.yaml', async () => {
      const res = await getDocs();
      expect(res.body).toContain("url: '/openapi.yaml'");
    });

    it('sets relaxed CSP that allows unpkg.com', async () => {
      const res = await getDocs();
      const csp = res.headers['content-security-policy'];
      expect(csp).toContain('https://unpkg.com');
      expect(csp).toContain("default-src 'none'");
    });

    it('hides the swagger topbar via inline style', async () => {
      const res = await getDocs();
      expect(res.body).toContain('.topbar { display: none; }');
    });
  });

  describe('getOpenapiYaml', () => {
    it('returns 200 with application/yaml content-type', async () => {
      const res = await getOpenapiYaml();
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/yaml; charset=utf-8');
    });

    it('returns the yaml body from loadOpenapiYaml', async () => {
      const res = await getOpenapiYaml();
      expect(res.body).toContain('openapi: 3.0.3');
    });

    it('sets wildcard CORS origin for cross-origin docs fetches', async () => {
      const res = await getOpenapiYaml();
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('sets public cache-control', async () => {
      const res = await getOpenapiYaml();
      expect(res.headers['cache-control']).toContain('public');
    });

    it('sets nosniff', async () => {
      const res = await getOpenapiYaml();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });
});
