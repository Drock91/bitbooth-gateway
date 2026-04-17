import { describe, it, expect } from 'vitest';
import { THEME_TOKENS, THEME_BASE, THEME_CSS } from '../../src/static/theme.css.js';
import { LANDING_CSS } from '../../src/static/landing.css.js';

describe('THEME_TOKENS', () => {
  it('exports a non-empty string', () => {
    expect(typeof THEME_TOKENS).toBe('string');
    expect(THEME_TOKENS.length).toBeGreaterThan(0);
  });

  it('contains :root selector', () => {
    expect(THEME_TOKENS).toContain(':root');
  });

  it('defines color-scheme dark', () => {
    expect(THEME_TOKENS).toContain('color-scheme: dark');
  });

  const requiredColors = [
    ['--bg', '#0b0d12'],
    ['--surface', '#11151d'],
    ['--ink', '#e6e9ef'],
    ['--ink-dim', '#8a93a6'],
    ['--accent', '#7cf1a0'],
    ['--accent-ink', '#072b14'],
    ['--line', '#1e2230'],
    ['--warn', '#ffb36b'],
    ['--error', '#ef4444'],
    ['--success', '#22c55e'],
  ];

  for (const [token, value] of requiredColors) {
    it(`defines ${token}: ${value}`, () => {
      expect(THEME_TOKENS).toContain(`${token}: ${value}`);
    });
  }

  it('defines --font-sans with system stack', () => {
    expect(THEME_TOKENS).toContain('--font-sans:');
    expect(THEME_TOKENS).toContain('system-ui');
  });

  it('defines --font-mono with monospace stack', () => {
    expect(THEME_TOKENS).toContain('--font-mono:');
    expect(THEME_TOKENS).toContain('Menlo');
  });

  const typographyTokens = [
    '--text-xs',
    '--text-sm',
    '--text-md',
    '--text-base',
    '--text-lg',
    '--text-xl',
    '--text-2xl',
    '--text-hero',
  ];
  for (const token of typographyTokens) {
    it(`defines typography token ${token}`, () => {
      expect(THEME_TOKENS).toContain(`${token}:`);
    });
  }

  it('defines line-height token', () => {
    expect(THEME_TOKENS).toContain('--lh: 1.55');
  });

  const spacingTokens = [
    '--sp-1',
    '--sp-2',
    '--sp-3',
    '--sp-4',
    '--sp-5',
    '--sp-6',
    '--sp-8',
    '--sp-10',
    '--sp-12',
    '--sp-16',
    '--sp-24',
  ];
  for (const token of spacingTokens) {
    it(`defines spacing token ${token}`, () => {
      expect(THEME_TOKENS).toContain(`${token}:`);
    });
  }

  const radiusTokens = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl'];
  for (const token of radiusTokens) {
    it(`defines radius token ${token}`, () => {
      expect(THEME_TOKENS).toContain(`${token}:`);
    });
  }

  const shadowTokens = ['--shadow-sm', '--shadow-md', '--shadow-lg'];
  for (const token of shadowTokens) {
    it(`defines shadow token ${token}`, () => {
      expect(THEME_TOKENS).toContain(`${token}:`);
    });
  }
});

describe('THEME_BASE', () => {
  it('exports a non-empty string', () => {
    expect(typeof THEME_BASE).toBe('string');
    expect(THEME_BASE.length).toBeGreaterThan(0);
  });

  it('includes box-sizing reset', () => {
    expect(THEME_BASE).toContain('box-sizing: border-box');
  });

  it('sets body background via token', () => {
    expect(THEME_BASE).toContain('background: var(--bg)');
  });

  it('sets body font via token', () => {
    expect(THEME_BASE).toContain('font-family: var(--font-sans)');
  });

  it('styles anchor color via token', () => {
    expect(THEME_BASE).toContain('a { color: var(--accent)');
  });

  it('includes .btn base class', () => {
    expect(THEME_BASE).toContain('.btn');
    expect(THEME_BASE).toContain('.btn-primary');
    expect(THEME_BASE).toContain('.btn-ghost');
  });

  it('includes form input styles', () => {
    expect(THEME_BASE).toContain('input[type="email"]');
    expect(THEME_BASE).toContain('input:focus');
  });

  it('includes table styles', () => {
    expect(THEME_BASE).toContain('table {');
    expect(THEME_BASE).toContain('th {');
    expect(THEME_BASE).toContain('td {');
  });

  it('includes .card class', () => {
    expect(THEME_BASE).toContain('.card {');
    expect(THEME_BASE).toContain('var(--surface)');
  });

  it('includes .alert classes', () => {
    expect(THEME_BASE).toContain('.alert {');
    expect(THEME_BASE).toContain('.alert.success');
    expect(THEME_BASE).toContain('.alert.error');
  });

  it('includes .badge classes', () => {
    expect(THEME_BASE).toContain('.badge {');
    expect(THEME_BASE).toContain('.badge.confirmed');
    expect(THEME_BASE).toContain('.badge.pending');
  });

  it('includes .muted utility', () => {
    expect(THEME_BASE).toContain('.muted {');
  });

  it('uses code font-family token', () => {
    expect(THEME_BASE).toContain('font-family: var(--font-mono)');
  });
});

describe('THEME_CSS', () => {
  it('is the concatenation of THEME_TOKENS and THEME_BASE', () => {
    expect(THEME_CSS).toBe(THEME_TOKENS + THEME_BASE);
  });

  it('starts with tokens (:root)', () => {
    expect(THEME_CSS.trimStart().startsWith(':root') || THEME_CSS.includes(':root')).toBe(true);
  });

  it('ends with base styles (not tokens)', () => {
    expect(THEME_CSS).toContain('.muted');
  });
});

describe('LANDING_CSS imports theme', () => {
  it('includes theme tokens', () => {
    expect(LANDING_CSS).toContain(':root');
    expect(LANDING_CSS).toContain('--bg: #0b0d12');
  });

  it('includes theme base styles', () => {
    expect(LANDING_CSS).toContain('.btn {');
    expect(LANDING_CSS).toContain('.card {');
  });

  it('includes landing-specific .wrap class', () => {
    expect(LANDING_CSS).toContain('.wrap {');
  });

  it('includes landing-specific .tier class', () => {
    expect(LANDING_CSS).toContain('.tier {');
  });

  it('includes landing-specific footer', () => {
    expect(LANDING_CSS).toContain('footer {');
  });

  it('includes landing-specific demo form styles', () => {
    expect(LANDING_CSS).toContain('form.demo');
    expect(LANDING_CSS).toContain('#demo-result');
  });

  it('uses tokens in overrides', () => {
    expect(LANDING_CSS).toContain('var(--sp-12)');
    expect(LANDING_CSS).toContain('var(--text-hero)');
    expect(LANDING_CSS).toContain('var(--surface)');
  });
});
