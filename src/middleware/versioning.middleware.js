const API_VERSION = '1.0.0';

/**
 * Wraps a Lambda handler to add API versioning and deprecation headers.
 * @param {(event: object, ctx?: object) => Promise<object>} fn
 * @param {{ deprecations?: Record<string, { sunset?: string, link?: string }> }} [opts]
 * @returns {(event: object, ctx?: object) => Promise<object>}
 */
export function withApiVersion(fn, opts = {}) {
  const deprecations = opts.deprecations ?? {};

  return async (event, ctx) => {
    const res = await fn(event, ctx);

    res.headers = { ...res.headers, 'x-api-version': API_VERSION };

    const routeKey = `${event.httpMethod} ${event.path}`;
    const dep = deprecations[routeKey];
    if (dep) {
      res.headers['deprecation'] = 'true';
      if (dep.sunset) res.headers['sunset'] = dep.sunset;
      if (dep.link) res.headers['link'] = `<${dep.link}>; rel="successor-version"`;
    }

    return res;
  };
}

export { API_VERSION };
