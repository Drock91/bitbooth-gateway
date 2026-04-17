/**
 * Obol shared design tokens + base component styles.
 * All colors pass WCAG AA contrast on --bg (#0b0d12).
 */

export const THEME_TOKENS = `
:root {
  color-scheme: dark;

  --bg: #0b0d12;
  --surface: #11151d;
  --ink: #e6e9ef;
  --ink-dim: #8a93a6;
  --accent: #7cf1a0;
  --accent-ink: #072b14;
  --line: #1e2230;
  --warn: #ffb36b;
  --error: #ef4444;
  --success: #22c55e;

  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "SFMono-Regular", Menlo, Consolas, monospace;

  --text-xs: 11px;
  --text-sm: 13px;
  --text-md: 15px;
  --text-base: 16px;
  --text-lg: 18px;
  --text-xl: 22px;
  --text-2xl: 28px;
  --text-hero: 44px;

  --lh: 1.55;

  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-8: 32px;
  --sp-10: 40px;
  --sp-12: 48px;
  --sp-16: 64px;
  --sp-24: 96px;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 10px;
  --radius-xl: 16px;

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 2px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 4px 20px rgba(0, 0, 0, 0.5);
}
`;

export const THEME_BASE = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  background: var(--bg); color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--text-base); line-height: var(--lh);
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code {
  font-family: var(--font-mono);
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 6px; border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}

.btn {
  display: inline-block;
  padding: var(--sp-3) var(--sp-5);
  border-radius: var(--radius-md);
  font-weight: 600; font-size: var(--text-md);
  border: 1px solid var(--line);
  cursor: pointer; font-family: inherit;
  transition: all 0.2s;
}
.btn-primary {
  background: var(--accent); color: var(--accent-ink);
  border-color: var(--accent);
}
.btn-primary:hover { text-decoration: none; filter: brightness(1.08); }
.btn-ghost { background: transparent; color: var(--ink); }
.btn-ghost:hover { text-decoration: none; border-color: var(--ink-dim); }

label { display: block; font-size: var(--text-sm); color: var(--ink-dim); margin-bottom: var(--sp-2); }
input[type="text"], input[type="email"], input[type="password"], input[type="search"] {
  width: 100%; padding: var(--sp-3) var(--sp-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: rgba(0, 0, 0, 0.3); color: var(--ink);
  font-size: var(--text-md); font-family: inherit; outline: none;
}
input:focus { border-color: var(--accent); }

table { width: 100%; border-collapse: collapse; margin: var(--sp-4) 0; font-size: var(--text-sm); }
th {
  text-align: left; padding: var(--sp-3);
  color: var(--ink-dim); font-size: var(--text-xs);
  text-transform: uppercase; letter-spacing: 0.5px;
  border-bottom: 1px solid var(--line);
}
td { padding: var(--sp-3); border-bottom: 1px solid rgba(255, 255, 255, 0.03); color: var(--ink-dim); }

.card {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius-xl); padding: var(--sp-6);
  margin-bottom: var(--sp-5);
}

.alert { padding: var(--sp-4); border-radius: var(--radius-lg); margin: var(--sp-4) 0; font-size: 14px; }
.alert.success { background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); color: var(--success); }
.alert.error { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: var(--error); }

.badge { font-size: var(--text-xs); font-weight: 600; padding: 2px 10px; border-radius: 6px; }
.badge.confirmed { background: rgba(34, 197, 94, 0.15); color: var(--success); }
.badge.pending { background: rgba(234, 179, 8, 0.15); color: #eab308; }

.muted { color: var(--ink-dim); font-size: var(--text-sm); }
`;

export const THEME_CSS = THEME_TOKENS + THEME_BASE;
