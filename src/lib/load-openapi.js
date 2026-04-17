import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';

const FALLBACK_YAML = `openapi: 3.0.3
info:
  title: Obol x402 Gateway
  version: 0.0.0
  description: openapi.yaml unavailable in this bundle — see /dashboard
paths: {}
`;

/**
 * Try a list of candidate paths and return the first one that exists.
 * Lambda bundles the openapi.yaml alongside the handler file, tests run
 * from the repo root, and local-server.js runs from src/. Cover all three.
 *
 * @returns {string | null}
 */
function resolveOpenapiPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', '..', 'openapi.yaml'),
    join(here, '..', 'openapi.yaml'),
    join(here, 'openapi.yaml'),
    resolve(process.cwd(), 'openapi.yaml'),
    '/var/task/openapi.yaml',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

let cached = null;

/**
 * Return the raw openapi.yaml contents as a string. Cached on first call.
 * Falls back to a minimal stub if the file is not shipped with the bundle
 * rather than crashing the Lambda — a broken /openapi.yaml route is
 * preferable to a crashed cold start.
 *
 * @returns {string}
 */
export function loadOpenapiYaml() {
  if (cached !== null) return cached;
  const path = resolveOpenapiPath();
  if (!path) {
    logger.warn({ event: 'openapi.not_found' }, 'openapi.yaml not found in any candidate path');
    cached = FALLBACK_YAML;
    return cached;
  }
  try {
    cached = readFileSync(path, 'utf8');
    return cached;
  } catch (err) {
    logger.warn(
      { event: 'openapi.read_failed', err: err?.message, path },
      'openapi.yaml read failed',
    );
    cached = FALLBACK_YAML;
    return cached;
  }
}

/** Test hook: clear the module-level cache between test cases. */
export function _resetOpenapiCache() {
  cached = null;
}
