import { describe, it, expect } from 'vitest';
import { renderPortalDashboard, renderPortalIntegrate } from '../../src/lib/portal-templates.js';

const TENANT = {
  accountId: 'acc-123',
  plan: 'starter',
  createdAt: '2026-01-15T00:00:00Z',
};

const PAYMENTS = [
  {
    idempotencyKey: 'nonce-1',
    amountWei: '100000',
    assetSymbol: 'USDC',
    status: 'confirmed',
    txHash: '0xabcdef1234567890abcdef1234567890',
    createdAt: '2026-04-01T12:00:00Z',
  },
];

const ROUTES = [{ path: '/api/data', priceWei: '50000', asset: 'USDC' }];

const USAGE = [
  { yearMonth: '2026-04', callCount: 42 },
  { yearMonth: '2026-03', callCount: 18 },
];

const BUCKET = { accountId: 'acc-123', tokens: 87.5, capacity: 100, refillRate: 1 };

function render(overrides = {}) {
  return renderPortalDashboard({
    tenant: TENANT,
    payments: PAYMENTS,
    routes: ROUTES,
    usage: USAGE,
    rateLimitBucket: BUCKET,
    ...overrides,
  });
}

describe('renderPortalDashboard', () => {
  it('returns valid HTML document', () => {
    const html = render();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes theme CSS variables', () => {
    const html = render();
    expect(html).toContain('--accent');
    expect(html).toContain('--bg');
  });

  it('includes CSP meta tag', () => {
    const html = render();
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'unsafe-inline'");
  });

  it('renders plan card', () => {
    const html = render();
    expect(html).toContain('Plan');
    expect(html).toContain('starter');
  });

  it('renders total calls from usage', () => {
    const html = render();
    expect(html).toContain('Total Calls');
    expect(html).toContain('>60<');
  });

  it('renders rate limit bucket', () => {
    const html = render();
    expect(html).toContain('Rate Limit');
    expect(html).toContain('87 / 100');
  });

  it('renders member since date', () => {
    const html = render();
    expect(html).toContain('Member Since');
    expect(html).toContain('2026-01-15T00:00:00Z');
  });

  it('renders sign-out link', () => {
    const html = render();
    expect(html).toContain('/portal/logout');
    expect(html).toContain('Sign Out');
  });

  it('renders API key section with reveal/rotate buttons', () => {
    const html = render();
    expect(html).toContain('Reveal');
    expect(html).toContain('Rotate');
    expect(html).toContain('apiKeyDisplay');
  });

  it('renders usage table with periods', () => {
    const html = render();
    expect(html).toContain('2026-04');
    expect(html).toContain('42');
    expect(html).toContain('2026-03');
    expect(html).toContain('18');
  });

  it('renders payments table', () => {
    const html = render();
    expect(html).toContain('nonce-1');
    expect(html).toContain('100000');
    expect(html).toContain('USDC');
    expect(html).toContain('confirmed');
  });

  it('truncates long tx hashes', () => {
    const html = render();
    expect(html).toContain('0xabcdef1234567890');
    expect(html).toContain('...');
  });

  it('renders routes table', () => {
    const html = render();
    expect(html).toContain('/api/data');
    expect(html).toContain('50000 wei');
  });

  it('escapes HTML in tenant data', () => {
    const html = render({
      tenant: { ...TENANT, plan: '<script>alert("xss")</script>' },
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in payment fields', () => {
    const html = render({
      payments: [{ ...PAYMENTS[0], idempotencyKey: '<img onerror=alert(1)>' }],
    });
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img');
  });

  it('renders empty usage message when no usage', () => {
    const html = render({ usage: [] });
    expect(html).toContain('No usage recorded yet.');
  });

  it('renders empty payments message when no payments', () => {
    const html = render({ payments: [] });
    expect(html).toContain('No payments yet.');
  });

  it('renders empty routes message when no routes', () => {
    const html = render({ routes: [] });
    expect(html).toContain('No routes configured.');
  });

  it('handles null rateLimitBucket with em dash', () => {
    const html = render({ rateLimitBucket: null });
    expect(html).toContain('\u2014 / \u2014');
  });

  it('handles null arrays gracefully', () => {
    const html = render({ payments: null, routes: null, usage: null });
    expect(html).toContain('No payments yet.');
    expect(html).toContain('No routes configured.');
    expect(html).toContain('No usage recorded yet.');
  });

  it('includes rotate-key fetch to /portal/rotate-key', () => {
    const html = render();
    expect(html).toContain('/portal/rotate-key');
    expect(html).toContain("method: 'POST'");
  });

  it('reveal script shows accountId', () => {
    const html = render();
    expect(html).toContain("el.textContent = 'acc-123'");
  });

  it('defaults missing plan to free', () => {
    const html = render({ tenant: { accountId: 'a', createdAt: '' } });
    expect(html).toContain('free');
  });

  it('renders page title', () => {
    const html = render();
    expect(html).toContain('<title>x402 — Portal</title>');
  });

  it('renders short tx hash without ellipsis', () => {
    const html = render({
      payments: [{ ...PAYMENTS[0], txHash: '0xshort' }],
    });
    expect(html).toContain('0xshort');
    expect(html).not.toContain('0xshort...');
  });

  it('handles missing txHash gracefully', () => {
    const html = render({
      payments: [{ ...PAYMENTS[0], txHash: undefined }],
    });
    expect(html).toContain('<code>');
  });

  it('floors bucket tokens to integer', () => {
    const html = render({ rateLimitBucket: { ...BUCKET, tokens: 42.99 } });
    expect(html).toContain('42 / 100');
  });

  it('uses fallbacks when tenant fields are undefined', () => {
    const html = render({
      tenant: { accountId: undefined, plan: undefined, createdAt: undefined },
    });
    // plan falls back to 'free'
    expect(html).toContain('>free<');
    // accountId fallback to '' ends up inside the reveal script string
    expect(html).toContain("el.textContent = ''");
  });

  it('falls back to 0 when usage row is missing callCount', () => {
    const html = render({
      usage: [{ yearMonth: '2026-02' }, { yearMonth: '2026-01' }],
    });
    expect(html).toContain('2026-02');
    // total calls summed with 0 fallback on both rows
    expect(html).toContain('>0<');
  });

  it('falls back to empty string when usage row is missing yearMonth', () => {
    const html = render({
      usage: [{ callCount: 5 }],
    });
    expect(html).toContain('<td></td>');
    expect(html).toContain('<td>5</td>');
  });

  it('falls back on missing payment fields', () => {
    const html = render({
      payments: [
        {
          idempotencyKey: undefined,
          amountWei: undefined,
          assetSymbol: undefined,
          status: undefined,
          txHash: undefined,
          createdAt: undefined,
        },
      ],
    });
    // badge class and content use '' fallback → `badge ` with trailing space
    expect(html).toContain('class="badge "');
    // empty code block for missing txHash
    expect(html).toContain('<code></code>');
  });

  it('falls back on missing route fields', () => {
    const html = render({
      routes: [{ path: undefined, priceWei: undefined, asset: undefined }],
    });
    expect(html).toContain('<code></code>');
    expect(html).toContain('0 wei');
    expect(html).toContain('USDC');
  });
});

describe('renderPortalIntegrate', () => {
  function renderIntegrate(overrides = {}) {
    return renderPortalIntegrate({
      accountId: 'acc-int-1',
      plan: 'growth',
      ...overrides,
    });
  }

  it('returns valid HTML document', () => {
    const html = renderIntegrate();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes theme CSS variables', () => {
    const html = renderIntegrate();
    expect(html).toContain('--accent');
    expect(html).toContain('--bg');
  });

  it('includes CSP meta tag', () => {
    const html = renderIntegrate();
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'unsafe-inline'");
  });

  it('renders page title', () => {
    const html = renderIntegrate();
    expect(html).toContain('<title>x402 — Integration Guide</title>');
  });

  it('renders account ID', () => {
    const html = renderIntegrate();
    expect(html).toContain('acc-int-1');
  });

  it('renders plan', () => {
    const html = renderIntegrate();
    expect(html).toContain('growth');
  });

  it('escapes HTML in accountId', () => {
    const html = renderIntegrate({ accountId: '<script>xss</script>' });
    expect(html).not.toContain('<script>xss');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in plan', () => {
    const html = renderIntegrate({ plan: '<img onerror=alert(1)>' });
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img');
  });

  it('defaults missing plan to free', () => {
    const html = renderIntegrate({ plan: undefined });
    expect(html).toContain('free');
  });

  it('defaults missing accountId to empty string', () => {
    const html = renderIntegrate({ accountId: undefined });
    expect(html).toContain('Account: <code></code>');
  });

  it('renders three tabs', () => {
    const html = renderIntegrate();
    expect(html).toContain('data-tab="curl"');
    expect(html).toContain('data-tab="javascript"');
    expect(html).toContain('data-tab="python"');
  });

  it('curl tab is active by default', () => {
    const html = renderIntegrate();
    expect(html).toMatch(/class="tab active"[^>]*data-tab="curl"/);
    expect(html).toContain('id="panel-curl" class="tab-panel active"');
  });

  it('includes curl code sample with X-PAYMENT header', () => {
    const html = renderIntegrate();
    expect(html).toContain('X-PAYMENT');
    expect(html).toContain('/v1/fetch');
  });

  it('includes JavaScript code sample with ethers', () => {
    const html = renderIntegrate();
    expect(html).toContain('ethers');
    expect(html).toContain('JsonRpcProvider');
    expect(html).toContain('AGENT_KEY');
  });

  it('includes Python code sample with web3', () => {
    const html = renderIntegrate();
    expect(html).toContain('Web3');
    expect(html).toContain('eth_account');
    expect(html).toContain('requests');
  });

  it('renders the three-step explanation', () => {
    const html = renderIntegrate();
    expect(html).toContain('Request a paid resource');
    expect(html).toContain('Pay on-chain');
    expect(html).toContain('Retry with proof');
  });

  it('includes step number badges', () => {
    const html = renderIntegrate();
    const matches = html.match(/<span class="step-num">/g);
    expect(matches.length).toBe(3);
  });

  it('links to dashboard', () => {
    const html = renderIntegrate();
    expect(html).toContain('/portal/dashboard');
  });

  it('links to sign out', () => {
    const html = renderIntegrate();
    expect(html).toContain('/portal/logout');
  });

  it('links to docs and openapi.yaml', () => {
    const html = renderIntegrate();
    expect(html).toContain('/docs');
    expect(html).toContain('/openapi.yaml');
  });

  it('includes tab switching script', () => {
    const html = renderIntegrate();
    expect(html).toContain('addEventListener');
    expect(html).toContain('data-tab');
  });

  it('uses aria attributes on tabs', () => {
    const html = renderIntegrate();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-selected');
  });

  it('includes tip about API key security', () => {
    const html = renderIntegrate();
    expect(html).toContain('Never expose it in client-side code');
  });

  it('mentions Base USDC in code samples', () => {
    const html = renderIntegrate();
    expect(html).toContain('eip155:8453');
    expect(html).toContain('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });
});
