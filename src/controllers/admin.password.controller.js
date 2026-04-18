import { adminService } from '../services/admin.service.js';
import { AdminChangePasswordBody } from '../validators/admin.schema.js';
import { escapeHtml } from '../lib/templates.js';
import { stagePrefix } from '../lib/stage-prefix.js';
import { enforceAdminRateLimit, extractClientIp } from '../middleware/rate-limit.middleware.js';
import { THEME_CSS, BRAND_BAR_CSS, brandBar, htmlResponse } from './admin.shared.js';

function renderChangePasswordPage({ error, success, event } = {}) {
  const base = stagePrefix(event);
  const msg = error
    ? `<div class="alert error">${escapeHtml(error)}</div>`
    : success
      ? `<div class="alert success">${escapeHtml(success)}</div>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x402 — Change Admin Password</title>
<style>${THEME_CSS}
${BRAND_BAR_CSS}
.admin-wrap { max-width: 1100px; margin: var(--sp-8) auto 0; padding: 0 var(--sp-4); }
.pw-card-wrap { max-width: 480px; margin: var(--sp-8) auto 0; }
.admin-title { font-size: var(--text-2xl); font-weight: 700; margin-bottom: var(--sp-2); }
.admin-sub { color: var(--ink-dim); font-size: var(--text-sm); margin-bottom: var(--sp-6); }
.form-group { margin-bottom: var(--sp-4); }
.form-group label { display: block; margin-bottom: var(--sp-2); font-size: var(--text-sm); }
.hint { color: var(--ink-dim); font-size: var(--text-xs); margin-top: var(--sp-1); }
.submit-btn { width: 100%; margin-top: var(--sp-3); }
.pw-wrap { position: relative; }
.pw-wrap input { padding-right: 56px; width: 100%; }
.pw-toggle {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  background: transparent; border: 1px solid var(--line); color: var(--ink-dim);
  font-size: var(--text-xs); font-family: inherit; cursor: pointer;
  padding: 4px 10px; border-radius: var(--radius-sm);
}
.pw-toggle:hover { background: rgba(255,255,255,0.08); color: var(--ink); }
.back-link { display: inline-block; margin-top: var(--sp-4); color: var(--ink-dim); text-decoration: none; font-size: var(--text-sm); }
.back-link:hover { color: var(--ink); }
.alert.success { background: rgba(34,197,94,0.1); color: var(--success); border: 1px solid rgba(34,197,94,0.3); padding: var(--sp-3); border-radius: var(--radius-md); margin-bottom: var(--sp-4); }
</style>
</head>
<body>
<div class="admin-wrap">
  ${brandBar('password', event)}
</div>
<div class="pw-card-wrap">
  <div class="admin-title">Change Admin Password</div>
  <p class="admin-sub">Rotate the admin key used to sign into /admin.</p>
  ${msg}
  <div class="card">
    <form method="POST" action="${base}/admin/change-password">
      <div class="form-group">
        <label for="current">Current Password</label>
        <div class="pw-wrap">
          <input type="password" id="current" name="currentPassword" required autocomplete="current-password">
          <button type="button" class="pw-toggle" data-for="current">Show</button>
        </div>
      </div>
      <div class="form-group">
        <label for="newpw">New Password</label>
        <div class="pw-wrap">
          <input type="password" id="newpw" name="newPassword" required minlength="12" autocomplete="new-password">
          <button type="button" class="pw-toggle" data-for="newpw">Show</button>
        </div>
        <div class="hint">Minimum 12 characters.</div>
      </div>
      <div class="form-group">
        <label for="confirm">Confirm New Password</label>
        <div class="pw-wrap">
          <input type="password" id="confirm" name="confirmPassword" required minlength="12" autocomplete="new-password">
          <button type="button" class="pw-toggle" data-for="confirm">Show</button>
        </div>
      </div>
      <button type="submit" class="btn btn-primary submit-btn">Update Password</button>
    </form>
  </div>
  <div style="text-align:center"><a href="${base}/admin/tenants/ui" class="back-link">&larr; Back to admin</a></div>
</div>
<script>
(function() {
  document.querySelectorAll('.pw-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var input = document.getElementById(btn.getAttribute('data-for'));
      if (!input) return;
      var showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
    });
  });
})();
</script>
</body>
</html>`;
}

export async function getAdminChangePassword(event) {
  const clientIp = extractClientIp(event);
  await enforceAdminRateLimit(clientIp);
  const cookieHeader = event?.headers?.cookie || event?.headers?.Cookie || '';
  await adminService.validateSession(cookieHeader);
  return htmlResponse(200, renderChangePasswordPage({ event }));
}

export async function postAdminChangePassword(event) {
  const clientIp = extractClientIp(event);
  await enforceAdminRateLimit(clientIp);
  const cookieHeader = event?.headers?.cookie || event?.headers?.Cookie || '';
  await adminService.validateSession(cookieHeader);

  const raw = event.body ?? '';
  const params = new URLSearchParams(raw);
  const parsed = AdminChangePasswordBody.safeParse({
    currentPassword: params.get('currentPassword') ?? '',
    newPassword: params.get('newPassword') ?? '',
    confirmPassword: params.get('confirmPassword') ?? '',
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || 'Invalid input';
    return htmlResponse(400, renderChangePasswordPage({ error: issue, event }));
  }

  try {
    await adminService.changeAdminKey(parsed.data.currentPassword, parsed.data.newPassword);
  } catch (e) {
    return htmlResponse(
      401,
      renderChangePasswordPage({ error: e?.message || 'Update failed', event }),
    );
  }

  await adminService.auditLog('changePassword', { ip: clientIp });
  return htmlResponse(
    200,
    renderChangePasswordPage({
      success: 'Password updated successfully. Use your new password next time you sign in.',
      event,
    }),
  );
}
