const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  // CORS on every response (success + error) so browser-side demo callers
  // can read 429/500 bodies. API GW handles OPTIONS preflight separately.
  // Safe with '*' because no demo endpoint uses cookies/credentials.
  'access-control-allow-origin': '*',
};

/**
 * Wraps a Lambda handler to add standard security headers to every response.
 * @param {(event: object, ctx?: object) => Promise<object>} fn
 * @returns {(event: object, ctx?: object) => Promise<object>}
 */
export function withSecurityHeaders(fn) {
  return async (event, ctx) => {
    const res = await fn(event, ctx);
    res.headers = { ...SECURITY_HEADERS, ...res.headers };
    return res;
  };
}

export { SECURITY_HEADERS };
