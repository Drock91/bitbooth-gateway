import { describe, it, expect } from 'vitest';
import { escapeHtml, renderPage, renderDashboard } from '../../src/lib/templates.js';

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------
describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('escapes less-than signs', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes greater-than signs', () => {
    expect(escapeHtml('a>b')).toBe('a&gt;b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes all special characters in one string', () => {
    expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('coerces numbers to string', () => {
    expect(escapeHtml(42)).toBe('42');
  });

  it('coerces null to string "null"', () => {
    expect(escapeHtml(null)).toBe('null');
  });

  it('coerces undefined to string "undefined"', () => {
    expect(escapeHtml(undefined)).toBe('undefined');
  });

  it('leaves safe strings untouched', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// renderPage
// ---------------------------------------------------------------------------
describe('renderPage', () => {
  it('returns valid HTML document', () => {
    const html = renderPage({});
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>x402 Dashboard</title>');
    expect(html).toContain('</html>');
  });

  it('renders signup result when provided', () => {
    const html = renderPage({
      signupResult: { accountId: 'acc-123', apiKey: 'key-456' },
    });
    expect(html).toContain('Account created!');
    expect(html).toContain('acc-123');
    expect(html).toContain('key-456');
    expect(html).toContain('Save this key now');
  });

  it('omits signup section when signupResult is falsy', () => {
    const html = renderPage({});
    expect(html).not.toContain('Account created!');
  });

  it('renders error alert when error is provided', () => {
    const html = renderPage({ error: 'Something broke' });
    expect(html).toContain('class="alert error"');
    expect(html).toContain('Something broke');
  });

  it('omits error section when error is falsy', () => {
    const html = renderPage({});
    expect(html).not.toContain('class="alert error"');
  });

  it('renders payment rows when payments array has items', () => {
    const html = renderPage({
      payments: [
        {
          idempotencyKey: 'nonce-1',
          amountWei: '1000',
          assetSymbol: 'USDC',
          status: 'confirmed',
          txHash: '0xabc',
          createdAt: '2026-01-01',
        },
      ],
    });
    expect(html).toContain('nonce-1');
    expect(html).toContain('1000');
    expect(html).toContain('USDC');
    expect(html).toContain('confirmed');
    expect(html).toContain('0xabc');
    expect(html).toContain('2026-01-01');
    expect(html).toContain('<thead>');
  });

  it('shows "No payments found" for empty payments array', () => {
    const html = renderPage({ payments: [] });
    expect(html).toContain('No payments found');
  });

  it('omits payments table when payments is undefined', () => {
    const html = renderPage({});
    expect(html).not.toContain('<thead>');
  });

  it('omits payments table when payments is null', () => {
    const html = renderPage({ payments: null });
    expect(html).not.toContain('<thead>');
  });

  it('handles payment fields that are null/undefined', () => {
    const html = renderPage({
      payments: [{ idempotencyKey: null, amountWei: undefined }],
    });
    // Should render empty strings, not crash
    expect(html).toContain('<tr>');
  });

  it('escapes XSS in signup result', () => {
    const html = renderPage({
      signupResult: {
        accountId: '<img src=x onerror=alert(1)>',
        apiKey: '"><script>alert(2)</script>',
      },
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(2)');
    expect(html).toContain('&lt;img src=x');
  });

  it('escapes XSS in error message', () => {
    const html = renderPage({ error: '<script>alert("xss")</script>' });
    expect(html).not.toContain('<script>alert("xss")');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes XSS in payment data', () => {
    const html = renderPage({
      payments: [{ status: '<b>bold</b>', txHash: '"><script>' }],
    });
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('renders multiple payment rows', () => {
    const payments = [
      { idempotencyKey: 'n1', status: 'confirmed' },
      { idempotencyKey: 'n2', status: 'pending' },
      { idempotencyKey: 'n3', status: 'failed' },
    ];
    const html = renderPage({ payments });
    expect(html).toContain('n1');
    expect(html).toContain('n2');
    expect(html).toContain('n3');
  });

  it('renders both signup and error simultaneously', () => {
    const html = renderPage({
      signupResult: { accountId: 'a1', apiKey: 'k1' },
      error: 'Warning message',
    });
    expect(html).toContain('Account created!');
    expect(html).toContain('Warning message');
  });

  it('contains signup form', () => {
    const html = renderPage({});
    expect(html).toContain('action="/dashboard/signup"');
    expect(html).toContain('Sign Up (Free Tier)');
  });

  it('contains lookup form', () => {
    const html = renderPage({});
    expect(html).toContain('action="/dashboard"');
    expect(html).toContain('name="accountId"');
  });
});

// ---------------------------------------------------------------------------
// renderDashboard
// ---------------------------------------------------------------------------
const baseDemoStats = {
  demo: { id: 'demo-id', key: 'demo-key' },
  stats: { tenants: 5, payments: 42, routes: 3 },
};

describe('renderDashboard', () => {
  it('returns valid HTML document', () => {
    const html = renderDashboard({ ...baseDemoStats });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>x402 — Dashboard</title>');
    expect(html).toContain('</html>');
  });

  it('renders demo banner with demo id and key', () => {
    const html = renderDashboard({ ...baseDemoStats });
    expect(html).toContain('demo-id');
    expect(html).toContain('demo-key');
    expect(html).toContain('Demo mode');
  });

  it('renders stats section', () => {
    const html = renderDashboard({ ...baseDemoStats });
    expect(html).toContain('>5<');
    expect(html).toContain('>42<');
    expect(html).toContain('>3<');
    expect(html).toContain('Tenants');
    expect(html).toContain('Payments');
    expect(html).toContain('Routes');
  });

  it('renders signup result with plan', () => {
    const html = renderDashboard({
      ...baseDemoStats,
      signupResult: { accountId: 'acc-1', apiKey: 'key-1', plan: 'starter' },
    });
    expect(html).toContain('Account created!');
    expect(html).toContain('acc-1');
    expect(html).toContain('key-1');
    expect(html).toContain('starter');
  });

  it('omits signup section when signupResult is falsy', () => {
    const html = renderDashboard({ ...baseDemoStats });
    expect(html).not.toContain('Account created!');
  });

  it('renders error alert', () => {
    const html = renderDashboard({ ...baseDemoStats, error: 'Bad request' });
    expect(html).toContain('class="alert error"');
    expect(html).toContain('Bad request');
  });

  it('omits error section when error is falsy', () => {
    const html = renderDashboard({ ...baseDemoStats });
    expect(html).not.toContain('class="alert error"');
  });

  it('renders payment rows with badge classes', () => {
    const html = renderDashboard({
      ...baseDemoStats,
      paymentList: [
        {
          idempotencyKey: 'n-1',
          amountWei: '500',
          assetSymbol: 'USDC',
          status: 'confirmed',
          txHash: '0x1234567890abcdef1234567890abcdef',
          createdAt: '2026-04-01',
        },
      ],
    });
    expect(html).toContain('n-1');
    expect(html).toContain('500');
    expect(html).toContain('class="badge confirmed"');
    // txHash is truncated to first 18 chars
    expect(html).toContain('0x1234567890abcdef');
    expect(html).toContain('...');
  });

  it('shows "No payments found" for empty paymentList', () => {
    const html = renderDashboard({ ...baseDemoStats, paymentList: [] });
    expect(html).toContain('No payments found');
  });

  it('omits payment table when paymentList is undefined', () => {
    const html = renderDashboard({ ...baseDemoStats });
    // Should not have payment thead
    const paymentTableMatch = html.match(/Nonce.*Amount.*Asset.*Status.*Tx Hash.*Date/);
    expect(paymentTableMatch).toBeNull();
  });

  it('renders route rows when tenantRoutes has items', () => {
    const html = renderDashboard({
      ...baseDemoStats,
      tenantRoutes: [
        { path: '/api/v1/data', priceWei: '1000', asset: 'USDC', createdAt: '2026-03-15' },
      ],
    });
    expect(html).toContain('/api/v1/data');
    expect(html).toContain('1000 wei');
    expect(html).toContain('USDC');
    expect(html).toContain('2026-03-15');
  });

  it('shows "No routes configured" when tenantRoutes is empty', () => {
    const html = renderDashboard({ ...baseDemoStats, tenantRoutes: [] });
    expect(html).toContain('No routes configured yet');
  });

  it('shows "No routes configured" when tenantRoutes is undefined', () => {
    const html = renderDashboard({ ...baseDemoStats });
    expect(html).toContain('No routes configured yet');
  });

  it('shows "No routes configured" when tenantRoutes is null', () => {
    const html = renderDashboard({ ...baseDemoStats, tenantRoutes: null });
    expect(html).toContain('No routes configured yet');
  });

  it('renders tenant accountId in lookup input value', () => {
    const html = renderDashboard({
      ...baseDemoStats,
      tenant: { accountId: 'tenant-uuid' },
    });
    expect(html).toContain('value="tenant-uuid"');
  });

  it('renders empty input value when tenant is undefined', () => {
    const html = renderDashboard({ ...baseDemoStats });
    expect(html).toContain('value=""');
  });

  it('handles route defaults for priceWei and asset', () => {
    const html = renderDashboard({
      ...baseDemoStats,
      tenantRoutes: [{ path: '/test' }],
    });
    expect(html).toContain('0 wei');
    expect(html).toContain('USDC');
  });

  it('escapes XSS in demo fields', () => {
    const html = renderDashboard({
      demo: { id: '<script>x</script>', key: '"><img>' },
      stats: { tenants: 0, payments: 0, routes: 0 },
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes XSS in payment text content', () => {
    const html = renderDashboard({
      ...baseDemoStats,
      paymentList: [{ status: 'confirmed', txHash: '0xabcdef', amountWei: '<b>bad</b>' }],
    });
    expect(html).toContain('&lt;b&gt;bad&lt;/b&gt;');
    expect(html).toContain('0xabcdef');
  });

  it('escapes XSS in route paths', () => {
    const html = renderDashboard({
      ...baseDemoStats,
      tenantRoutes: [{ path: '<img onerror=alert(1)>' }],
    });
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img onerror=alert(1)&gt;');
  });

  it('renders multiple routes', () => {
    const html = renderDashboard({
      ...baseDemoStats,
      tenantRoutes: [
        { path: '/a', priceWei: '100' },
        { path: '/b', priceWei: '200' },
      ],
    });
    expect(html).toContain('/a');
    expect(html).toContain('/b');
    expect(html).toContain('100 wei');
    expect(html).toContain('200 wei');
  });

  it('renders pending badge class', () => {
    const html = renderDashboard({
      ...baseDemoStats,
      paymentList: [{ status: 'pending', txHash: '' }],
    });
    expect(html).toContain('class="badge pending"');
  });

  it('handles paymentList with null fields', () => {
    const html = renderDashboard({
      ...baseDemoStats,
      paymentList: [
        {
          idempotencyKey: null,
          amountWei: null,
          assetSymbol: null,
          status: null,
          txHash: null,
          createdAt: null,
        },
      ],
    });
    expect(html).toContain('<tr>');
  });

  it('contains signup form', () => {
    const html = renderDashboard({ ...baseDemoStats });
    expect(html).toContain('action="/dashboard/signup"');
    expect(html).toContain('Sign Up (Free Tier)');
  });

  it('contains lookup form', () => {
    const html = renderDashboard({ ...baseDemoStats });
    expect(html).toContain('action="/dashboard"');
    expect(html).toContain('name="accountId"');
  });

  it('renders all sections together', () => {
    const html = renderDashboard({
      ...baseDemoStats,
      signupResult: { accountId: 'a', apiKey: 'k', plan: 'free' },
      error: 'warn',
      paymentList: [{ idempotencyKey: 'p1', status: 'confirmed', txHash: '0x123456789012345678' }],
      tenantRoutes: [{ path: '/r1', priceWei: '10' }],
      tenant: { accountId: 'tid' },
    });
    expect(html).toContain('Account created!');
    expect(html).toContain('class="alert error"');
    expect(html).toContain('p1');
    expect(html).toContain('/r1');
    expect(html).toContain('value="tid"');
  });
});
