const SWAGGER_INIT_JS = `
window.onload = function() {
  window.ui = SwaggerUIBundle({
    url: '/openapi.yaml',
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: 'StandaloneLayout',
    tryItOutEnabled: true,
    displayRequestDuration: true,
    filter: true
  });
};
`;

// BitBooth-branded dark theme override for Swagger UI. The default Swagger
// stylesheet assumes a white background — text colors come out near-invisible
// on dark. This overrides the high-traffic selectors so body text + headings
// stay readable while we keep the BitBooth aesthetic (gradient brand, accent
// purple/teal). Updated whenever Swagger UI's class names change.
const DARK_THEME_CSS = `
:root {
  --bb-bg: #05070b;
  --bb-bg2: #0b1019;
  --bb-panel: #111827;
  --bb-panel2: #161e2e;
  --bb-border: rgba(255, 255, 255, 0.08);
  --bb-border2: rgba(255, 255, 255, 0.14);
  --bb-ink: #e7ecf3;
  --bb-ink-dim: #b8c2d4;
  --bb-ink-mute: #8794ab;
  --bb-accent: #14F195;
  --bb-accent2: #23E5DB;
  --bb-accent3: #b78bff;
  --bb-method-get: #3b82f6;
  --bb-method-post: #22c55e;
  --bb-method-put: #f59e0b;
  --bb-method-delete: #ef4444;
  --bb-mono: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
  --bb-sans: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}

html, body {
  margin: 0; padding: 0;
  background: radial-gradient(ellipse at top, #0f1624 0%, #080b12 50%, #05070b 100%) fixed;
  color: var(--bb-ink);
  font-family: var(--bb-sans);
}

/* ===== BitBooth top bar ===== */
.bb-bar {
  background: linear-gradient(180deg, #0f1624 0%, #0b1019 100%);
  border-bottom: 1px solid var(--bb-border);
  padding: 14px 24px;
  display: flex;
  align-items: center;
  gap: 14px;
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(8px);
}
.bb-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.bb-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: linear-gradient(135deg, var(--bb-accent) 0%, var(--bb-accent2) 50%, #0052FF 100%);
  box-shadow: 0 0 12px rgba(20, 241, 149, 0.5);
}
.bb-name {
  font-size: 16px; font-weight: 700; letter-spacing: -0.01em;
  background: linear-gradient(90deg, #fff 0%, #cfd8e8 100%);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.bb-divider { width: 1px; height: 20px; background: rgba(255, 255, 255, 0.12); }
.bb-section {
  font-family: var(--bb-mono); font-size: 11px; letter-spacing: 0.2em;
  text-transform: uppercase; color: var(--bb-ink-mute);
}
.bb-spacer { flex: 1; }
.bb-nav { display: flex; gap: 4px; align-items: center; }
.bb-nav a {
  padding: 7px 14px; border-radius: 6px; font-size: 13px;
  color: var(--bb-ink-dim); text-decoration: none;
  transition: background 0.1s, color 0.1s;
}
.bb-nav a:hover { background: rgba(255, 255, 255, 0.06); color: var(--bb-ink); }
.bb-nav a.cta {
  background: linear-gradient(135deg, var(--bb-accent), var(--bb-accent2));
  color: #0a0f18; font-weight: 600;
}
.bb-nav a.cta:hover { filter: brightness(1.1); }

/* ===== Swagger UI overrides ===== */
#swagger-ui { max-width: 1200px; margin: 0 auto; padding: 24px; }
.swagger-ui { color: var(--bb-ink); }
.swagger-ui .topbar { display: none; }

/* Headings */
.swagger-ui .info, .swagger-ui .scheme-container { background: transparent !important; box-shadow: none !important; padding: 0 !important; margin-bottom: 24px !important; }
.swagger-ui .info .title,
.swagger-ui .info h1, .swagger-ui .info h2, .swagger-ui .info h3, .swagger-ui .info h4, .swagger-ui .info h5, .swagger-ui .info h6,
.swagger-ui h2, .swagger-ui h3, .swagger-ui h4 {
  color: var(--bb-ink) !important;
  font-family: var(--bb-sans);
  letter-spacing: -0.01em;
}
.swagger-ui .info .title { font-size: 36px; font-weight: 800; }
.swagger-ui .info .title small { background: var(--bb-panel2); color: var(--bb-ink-dim); padding: 2px 8px; border-radius: 4px; font-size: 12px; vertical-align: middle; }
.swagger-ui .info .title small.version-stamp { background: var(--bb-accent); color: #0a0f18; font-weight: 700; }

/* Body / paragraph text — the critical fix */
.swagger-ui .info p, .swagger-ui .info li, .swagger-ui .info table,
.swagger-ui .info .description,
.swagger-ui .markdown p, .swagger-ui .markdown li, .swagger-ui .markdown td,
.swagger-ui .renderedMarkdown p, .swagger-ui .renderedMarkdown li,
.swagger-ui p, .swagger-ui table tbody tr td, .swagger-ui table tbody tr th,
.swagger-ui .opblock-description-wrapper, .swagger-ui .opblock-description-wrapper p,
.swagger-ui .opblock-external-docs-wrapper p, .swagger-ui .response-col_description p,
.swagger-ui label, .swagger-ui .parameter__name, .swagger-ui .parameter__type,
.swagger-ui .parameter__deprecated, .swagger-ui .parameter__in,
.swagger-ui .parameters-col_description p,
.swagger-ui .response-col_status, .swagger-ui .response-col_description {
  color: var(--bb-ink-dim) !important;
  font-family: var(--bb-sans);
}
.swagger-ui table thead tr th { color: var(--bb-ink) !important; border-bottom-color: var(--bb-border) !important; }
.swagger-ui table tbody tr td { border-bottom-color: var(--bb-border) !important; }

/* Code + inline code */
.swagger-ui code, .swagger-ui pre, .swagger-ui .highlight-code, .swagger-ui .microlight {
  background: #0a0f18 !important;
  color: var(--bb-ink) !important;
  border: 1px solid var(--bb-border) !important;
  font-family: var(--bb-mono) !important;
  font-size: 12.5px !important;
}
.swagger-ui .info a, .swagger-ui .markdown a, .swagger-ui .renderedMarkdown a, .swagger-ui a.nostyle {
  color: var(--bb-accent2) !important;
}
.swagger-ui .info a:hover, .swagger-ui .markdown a:hover { color: var(--bb-accent) !important; }

/* Operation blocks (the per-endpoint cards) */
.swagger-ui .opblock {
  background: var(--bb-panel) !important;
  border: 1px solid var(--bb-border) !important;
  border-radius: 8px !important;
  margin: 10px 0 !important;
  box-shadow: none !important;
}
.swagger-ui .opblock .opblock-summary {
  border-color: transparent !important;
  background: transparent !important;
}
.swagger-ui .opblock .opblock-summary-path,
.swagger-ui .opblock .opblock-summary-path__deprecated,
.swagger-ui .opblock .opblock-summary-description {
  color: var(--bb-ink) !important;
  font-family: var(--bb-mono);
  font-weight: 500;
}
.swagger-ui .opblock .opblock-summary-method {
  font-family: var(--bb-mono); font-weight: 700; min-width: 80px; text-align: center;
}
.swagger-ui .opblock.opblock-get .opblock-summary-method { background: var(--bb-method-get); }
.swagger-ui .opblock.opblock-post .opblock-summary-method { background: var(--bb-method-post); }
.swagger-ui .opblock.opblock-put .opblock-summary-method { background: var(--bb-method-put); }
.swagger-ui .opblock.opblock-delete .opblock-summary-method { background: var(--bb-method-delete); }
.swagger-ui .opblock.opblock-get { border-left: 3px solid var(--bb-method-get) !important; }
.swagger-ui .opblock.opblock-post { border-left: 3px solid var(--bb-method-post) !important; }
.swagger-ui .opblock.opblock-put { border-left: 3px solid var(--bb-method-put) !important; }
.swagger-ui .opblock.opblock-delete { border-left: 3px solid var(--bb-method-delete) !important; }

.swagger-ui .opblock-tag {
  color: var(--bb-ink) !important;
  font-family: var(--bb-sans); font-weight: 600;
  border-bottom-color: var(--bb-border) !important;
}
.swagger-ui .opblock-tag small { color: var(--bb-ink-mute) !important; font-weight: 400; }
.swagger-ui .opblock-tag:hover { background: rgba(255, 255, 255, 0.02); }

/* Buttons */
.swagger-ui .btn {
  background: var(--bb-panel2);
  color: var(--bb-ink);
  border: 1px solid var(--bb-border2);
  font-family: var(--bb-sans);
  border-radius: 6px;
}
.swagger-ui .btn:hover { background: var(--bb-border2); }
.swagger-ui .btn.execute { background: linear-gradient(135deg, var(--bb-accent), var(--bb-accent2)); color: #0a0f18; border: none; font-weight: 700; }
.swagger-ui .btn.try-out__btn { color: var(--bb-accent); border-color: var(--bb-accent); background: transparent; }
.swagger-ui .btn.cancel { background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: rgba(239, 68, 68, 0.3); }

/* Inputs */
.swagger-ui input[type=text], .swagger-ui input[type=password], .swagger-ui input[type=email],
.swagger-ui textarea, .swagger-ui select {
  background: var(--bb-bg2) !important;
  color: var(--bb-ink) !important;
  border: 1px solid var(--bb-border2) !important;
  border-radius: 4px;
  font-family: var(--bb-mono);
  font-size: 13px;
}
.swagger-ui input[type=text]::placeholder, .swagger-ui textarea::placeholder { color: var(--bb-ink-mute) !important; }

/* Models / schemas */
.swagger-ui section.models { background: var(--bb-panel) !important; border: 1px solid var(--bb-border) !important; border-radius: 8px; }
.swagger-ui section.models h4, .swagger-ui section.models .model-title { color: var(--bb-ink) !important; }
.swagger-ui .model-box { background: var(--bb-bg2) !important; border-color: var(--bb-border) !important; }
.swagger-ui .model { color: var(--bb-ink-dim) !important; font-family: var(--bb-mono); }
.swagger-ui .property-row td, .swagger-ui .property { color: var(--bb-ink-dim) !important; }
.swagger-ui .prop-format, .swagger-ui .prop-type { color: var(--bb-accent3) !important; }

/* Responses */
.swagger-ui .responses-table .response { background: var(--bb-panel2) !important; }
.swagger-ui .response-col_status { color: var(--bb-ink) !important; font-family: var(--bb-mono); font-weight: 700; }
.swagger-ui .responses-inner { background: transparent; padding: 16px 0; }
.swagger-ui .responses-inner h4, .swagger-ui .responses-inner h5 { color: var(--bb-ink) !important; }

/* Filter input */
.swagger-ui .filter .operation-filter-input {
  background: var(--bb-bg2) !important;
  color: var(--bb-ink) !important;
  border: 1px solid var(--bb-border2) !important;
}

/* Authorize button in top right */
.swagger-ui .auth-wrapper .authorize { background: var(--bb-panel2); color: var(--bb-ink); border-color: var(--bb-border2); }
.swagger-ui .auth-wrapper .authorize svg { fill: var(--bb-accent); }

/* Modal (auth dialog etc) */
.swagger-ui .dialog-ux .modal-ux { background: var(--bb-panel) !important; border-color: var(--bb-border) !important; }
.swagger-ui .dialog-ux .modal-ux-header h3, .swagger-ui .dialog-ux .modal-ux-content { color: var(--bb-ink) !important; }
`;

export const SWAGGER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BitBooth API — Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
    <style>${DARK_THEME_CSS}</style>
  </head>
  <body>
    <div class="bb-bar">
      <a href="/" class="bb-brand">
        <span class="bb-dot"></span>
        <span class="bb-name">BitBooth</span>
      </a>
      <div class="bb-divider"></div>
      <div class="bb-section">API Reference</div>
      <div class="bb-spacer"></div>
      <nav class="bb-nav">
        <a href="/docs/agents">Agent Setup</a>
        <a href="https://github.com/Drock91/bitbooth-gateway" target="_blank" rel="noopener">GitHub</a>
        <a href="https://www.npmjs.com/package/@bitbooth/mcp-fetch" target="_blank" rel="noopener">npm</a>
        <a href="/dashboard/signup" class="cta">Get API key →</a>
      </nav>
    </div>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" crossorigin></script>
    <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-standalone-preset.js" crossorigin></script>
    <script>${SWAGGER_INIT_JS}</script>
  </body>
</html>
`;
