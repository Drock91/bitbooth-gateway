import { THEME_CSS } from './theme.css.js';

const LANDING_OVERRIDES = `
.wrap { max-width: 860px; margin: 0 auto; padding: var(--sp-12) var(--sp-6) var(--sp-24); }
header .mark { font-weight: 700; letter-spacing: 0.02em; font-size: var(--text-lg); }
header nav { float: right; font-size: 14px; color: var(--ink-dim); }
header nav a { margin-left: var(--sp-5); }
h1 { font-size: var(--text-hero); line-height: 1.1; margin: 56px 0 var(--sp-3); letter-spacing: -0.02em; }
.tagline { font-size: 20px; color: var(--ink-dim); margin: 0 0 var(--sp-8); }
.cta-row { display: flex; gap: var(--sp-3); flex-wrap: wrap; margin: var(--sp-6) 0 var(--sp-10); }
section { margin: var(--sp-12) 0; }
h2 { font-size: var(--text-xl); margin: 0 0 var(--sp-4); letter-spacing: -0.01em; }
ol.steps { padding-left: var(--sp-5); color: var(--ink-dim); }
ol.steps li { margin: 10px 0; }
ol.steps strong { color: var(--ink); }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: var(--sp-6); }
pre {
  background: #080a0f; border: 1px solid var(--line); border-radius: var(--radius-md);
  padding: var(--sp-4); overflow-x: auto; font-size: var(--text-sm); color: var(--ink);
}
.tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--sp-3); margin-top: var(--sp-2); }
.tier { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: var(--sp-5); }
.tier h3 { margin: 0 0 6px; font-size: var(--text-base); }
.tier .price { color: var(--accent); font-weight: 600; font-size: var(--text-xl); }
.tier ul { padding-left: var(--sp-5); margin: 10px 0 0; color: var(--ink-dim); font-size: var(--text-sm); }
form.demo label { display: block; font-size: var(--text-sm); color: var(--ink-dim); margin-bottom: 6px; }
form.demo input[type="email"] {
  width: 100%; padding: 10px var(--sp-3); border-radius: var(--radius-md);
  border: 1px solid var(--line); background: #080a0f; color: var(--ink); font-size: var(--text-md);
}
form.demo button { margin-top: 10px; }
#demo-result { margin-top: 14px; font-size: var(--text-sm); }
#demo-result.ok { color: var(--accent); }
#demo-result.err { color: var(--warn); }
footer {
  margin-top: 80px; padding-top: var(--sp-6); border-top: 1px solid var(--line);
  color: var(--ink-dim); font-size: var(--text-sm);
}
`;

export const LANDING_CSS = THEME_CSS + LANDING_OVERRIDES;
