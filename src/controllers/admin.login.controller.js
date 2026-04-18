import { adminService } from '../services/admin.service.js';
import { AdminLoginBody } from '../validators/admin.schema.js';
import { ValidationError } from '../lib/errors.js';
import { THEME_CSS } from '../static/theme.css.js';
import { escapeHtml } from '../lib/templates.js';
import { stagePrefix } from '../lib/stage-prefix.js';
import { enforceAdminRateLimit, extractClientIp } from '../middleware/rate-limit.middleware.js';
import { htmlResponse } from './admin.shared.js';

function renderAdminLoginPage({ error, event } = {}) {
  const base = stagePrefix(event);
  const errorBlock = error ? `<div class="alert error">${escapeHtml(error)}</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BitBooth — Admin</title>
<style>${THEME_CSS}
body { background: radial-gradient(ellipse at top, #0f1624 0%, #080b12 50%, #05070b 100%); min-height: 100vh; }
.admin-wrap { max-width: 440px; margin: 0 auto; padding: 10vh var(--sp-4) var(--sp-8); }
.brand-block { display: flex; flex-direction: column; align-items: center; margin-bottom: var(--sp-8); }
.brand-logo { display: flex; align-items: center; gap: 12px; margin-bottom: var(--sp-3); }
.brand-dot {
  width: 14px; height: 14px; border-radius: 50%;
  background: linear-gradient(135deg, #14F195 0%, #23E5DB 50%, #0052FF 100%);
  box-shadow: 0 0 24px rgba(20,241,149,0.4), 0 0 48px rgba(20,241,149,0.15);
  animation: glow 3s ease-in-out infinite;
}
@keyframes glow { 0%,100% { box-shadow: 0 0 24px rgba(20,241,149,0.4), 0 0 48px rgba(20,241,149,0.15); } 50% { box-shadow: 0 0 28px rgba(35,229,219,0.5), 0 0 56px rgba(35,229,219,0.2); } }
.brand-name { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; background: linear-gradient(90deg, #fff 0%, #cfd8e8 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.brand-sub { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: 0.25em; text-transform: uppercase; color: var(--ink-dim); }
.admin-title { font-size: var(--text-xl); font-weight: 600; margin-bottom: var(--sp-2); text-align: center; }
.admin-sub { color: var(--ink-dim); font-size: var(--text-sm); margin-bottom: var(--sp-6); text-align: center; }
.form-group { margin-bottom: var(--sp-5); }
.form-group label { margin-bottom: var(--sp-2); display: block; font-size: var(--text-sm); color: var(--ink-dim); }
.login-btn { width: 100%; margin-top: var(--sp-2); padding: 12px 16px; font-weight: 600; }
.pw-wrap { position: relative; }
.pw-wrap input { padding-right: 64px; width: 100%; }
.pw-toggle {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  background: transparent; border: 1px solid var(--line); color: var(--ink-dim);
  font-size: var(--text-xs); font-family: inherit; cursor: pointer;
  padding: 4px 10px; border-radius: var(--radius-sm);
  transition: background 0.1s, color 0.1s;
}
.pw-toggle:hover { background: rgba(255,255,255,0.08); color: var(--ink); }
.pw-toggle:focus { outline: 1px solid var(--brand); outline-offset: 1px; }
.login-footer { text-align: center; margin-top: var(--sp-6); font-size: var(--text-xs); color: var(--ink-dim); font-family: 'JetBrains Mono', ui-monospace, monospace; }
.login-footer a { color: var(--ink-dim); text-decoration: none; }
.login-footer a:hover { color: var(--ink); }
.card { backdrop-filter: blur(12px); background: rgba(17,22,35,0.6); border: 1px solid rgba(255,255,255,0.08); }
</style>
</head>
<body>
<div class="admin-wrap">
  <div class="brand-block">
    <div class="brand-logo">
      <span class="brand-dot"></span>
      <span class="brand-name">BitBooth</span>
    </div>
    <div class="brand-sub">Agent Payment Gateway</div>
  </div>
  <div class="admin-title">Admin Access</div>
  <p class="admin-sub">Sign in with your admin key to continue</p>
  ${errorBlock}
  <div class="card">
    <form method="POST" action="${base}/admin/login">
      <div class="form-group">
        <label for="password">Admin Key</label>
        <div class="pw-wrap">
          <input type="password" id="password" name="password" required placeholder="Enter admin key" autocomplete="current-password">
          <button type="button" class="pw-toggle" id="pw-toggle" aria-label="Show password">Show</button>
        </div>
      </div>
      <button type="submit" class="btn btn-primary login-btn">Sign In</button>
    </form>
  </div>
  <div class="login-footer">x402 V2 · Built on <a href="https://x402.gitbook.io" target="_blank" rel="noopener">x402 protocol</a></div>
</div>
<script>
(function() {
  var btn = document.getElementById('pw-toggle');
  var input = document.getElementById('password');
  if (!btn || !input) return;
  btn.addEventListener('click', function() {
    var showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.textContent = showing ? 'Show' : 'Hide';
    btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    input.focus();
  });
})();
</script>
</body>
</html>`;
}

export async function getAdmin(event) {
  return htmlResponse(200, renderAdminLoginPage({ event }));
}

export async function postAdminLogin(event) {
  const clientIp = extractClientIp(event);
  await enforceAdminRateLimit(clientIp);

  const raw = event.body ?? '';
  const params = new URLSearchParams(raw);
  const parsed = AdminLoginBody.safeParse({
    password: params.get('password') ?? '',
  });

  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues);
  }

  await adminService.verifyAdminKey(parsed.data.password);
  const cookie = await adminService.createSessionCookie();

  await adminService.auditLog('login', { ip: clientIp });

  return {
    statusCode: 303,
    headers: {
      location: `${stagePrefix(event)}/admin/tenants/ui`,
      'set-cookie': cookie.options,
      'cache-control': 'no-store',
    },
    body: '',
  };
}

export async function getAdminLogout(event) {
  const cookieHeader = event?.headers?.cookie || event?.headers?.Cookie || '';
  try {
    await adminService.validateSession(cookieHeader);
    await adminService.auditLog('logout', {});
  } catch {
    // Clearing cookie even if session is invalid/expired
  }

  return {
    statusCode: 303,
    headers: {
      location: `${stagePrefix(event)}/admin`,
      'set-cookie': adminService.clearCookie(),
      'cache-control': 'no-store',
    },
    body: '',
  };
}
