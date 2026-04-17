import { THEME_CSS } from './theme.css.js';

const FETCH_OVERRIDES = `
.wrap { max-width: 860px; margin: 0 auto; padding: var(--sp-12) var(--sp-6) var(--sp-24); }
header { display: flex; align-items: center; justify-content: space-between; }
header .mark { font-weight: 700; letter-spacing: 0.02em; font-size: var(--text-lg); }
header nav { font-size: 14px; color: var(--ink-dim); }
header nav a { margin-left: var(--sp-5); }
h1 { font-size: var(--text-hero); line-height: 1.1; margin: 56px 0 var(--sp-3); letter-spacing: -0.02em; }
.tagline { font-size: 20px; color: var(--ink-dim); margin: 0 0 var(--sp-8); max-width: 640px; }
.cta-row { display: flex; gap: var(--sp-3); flex-wrap: wrap; margin: var(--sp-6) 0 var(--sp-10); }
section { margin: var(--sp-12) 0; }
h2 { font-size: var(--text-xl); margin: 0 0 var(--sp-4); letter-spacing: -0.01em; }
.price-pill {
  display: inline-block; background: rgba(124, 241, 160, 0.12);
  color: var(--accent); font-weight: 600; font-size: var(--text-sm);
  padding: 4px 14px; border-radius: 20px; margin-bottom: var(--sp-4);
}
ol.steps { padding-left: var(--sp-5); color: var(--ink-dim); }
ol.steps li { margin: 10px 0; }
ol.steps strong { color: var(--ink); }
pre {
  background: #080a0f; border: 1px solid var(--line); border-radius: var(--radius-md);
  padding: var(--sp-4); overflow-x: auto; font-size: var(--text-sm); color: var(--ink);
  line-height: 1.5;
}
pre .kw { color: #c792ea; }
pre .str { color: #c3e88d; }
pre .cmt { color: #546e7a; }
pre .fn { color: #82aaff; }
pre .num { color: #f78c6c; }
.tabs { display: flex; gap: 0; margin-bottom: 0; border-bottom: 1px solid var(--line); }
.tab {
  padding: var(--sp-2) var(--sp-4); font-size: var(--text-sm); font-weight: 600;
  color: var(--ink-dim); background: transparent; border: none; cursor: pointer;
  border-bottom: 2px solid transparent; font-family: inherit;
  transition: color 0.15s, border-color 0.15s;
}
.tab:hover { color: var(--ink); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-panel { display: none; }
.tab-panel.active { display: block; }
.demo-box {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius-lg); overflow: hidden;
}
.demo-box .demo-header {
  padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--line);
  display: flex; align-items: center; justify-content: space-between;
}
.demo-box .demo-header span { font-size: var(--text-sm); color: var(--ink-dim); }
.demo-box .demo-body { padding: var(--sp-4); }
.demo-box .demo-body input[type="text"] { margin-bottom: var(--sp-3); }
.demo-output {
  background: #080a0f; border: 1px solid var(--line); border-radius: var(--radius-md);
  padding: var(--sp-4); margin-top: var(--sp-3); font-family: var(--font-mono);
  font-size: var(--text-sm); color: var(--ink-dim); min-height: 80px;
  white-space: pre-wrap; word-break: break-word;
}
.demo-output .phase { color: var(--accent); font-weight: 600; }
.demo-output .err { color: var(--error); }
.features {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--sp-4); margin-top: var(--sp-4);
}
.feature {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius-lg); padding: var(--sp-5);
}
.feature h3 { font-size: var(--text-base); margin: 0 0 6px; }
.feature p { color: var(--ink-dim); font-size: var(--text-sm); margin: 0; }
.pricing-table {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius-lg); padding: var(--sp-6);
}
.pricing-table h3 { font-size: var(--text-lg); margin: 0 0 var(--sp-2); }
.pricing-table .big-price {
  font-size: var(--text-hero); font-weight: 700; color: var(--accent);
  letter-spacing: -0.02em;
}
.pricing-table .big-price small {
  font-size: var(--text-lg); color: var(--ink-dim); font-weight: 400;
}
.pricing-table ul { padding-left: var(--sp-5); margin: var(--sp-4) 0 0; color: var(--ink-dim); font-size: var(--text-sm); }
.pricing-table li { margin: 6px 0; }
footer {
  margin-top: 80px; padding-top: var(--sp-6); border-top: 1px solid var(--line);
  color: var(--ink-dim); font-size: var(--text-sm);
}
@media (max-width: 600px) {
  h1 { font-size: 32px; }
  .tagline { font-size: 17px; }
  .features { grid-template-columns: 1fr; }
}
`;

export const FETCH_CSS = THEME_CSS + FETCH_OVERRIDES;
