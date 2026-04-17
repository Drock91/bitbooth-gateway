import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import {
  getSpecRoutes,
  extractRouteKeys,
  getCodeRoutes,
  compareRoutes,
} from '../../scripts/validate-openapi.js';

function makeTmpDir() {
  const dir = resolve(tmpdir(), `validate-openapi-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSpec(dir, paths) {
  const specPath = resolve(dir, 'openapi.yaml');
  writeFileSync(
    specPath,
    yaml.dump({ openapi: '3.0.3', info: { title: 'test', version: '0.1.0' }, paths }),
  );
  return specPath;
}

function writeRouteFile(dir, relativePath, content) {
  const full = resolve(dir, relativePath);
  mkdirSync(resolve(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

describe('extractRouteKeys', () => {
  it('extracts METHOD /path patterns from route objects', () => {
    const src = `const routes = {
      'GET /v1/health': getHealth,
      'POST /v1/quote': postQuote,
    };`;
    expect(extractRouteKeys(src)).toEqual(['GET /v1/health', 'POST /v1/quote']);
  });

  it('handles double-quoted keys', () => {
    const src = `const routes = { "DELETE /dashboard/routes": deleteRoute };`;
    expect(extractRouteKeys(src)).toEqual(['DELETE /dashboard/routes']);
  });

  it('returns empty array for no matches', () => {
    expect(extractRouteKeys('const x = 42;')).toEqual([]);
  });

  it('handles nested paths', () => {
    const src = `'GET /v1/health/ready': getHealthReady,`;
    expect(extractRouteKeys(src)).toEqual(['GET /v1/health/ready']);
  });

  it('ignores non-method strings', () => {
    const src = `'hello /world': fn,`;
    expect(extractRouteKeys(src)).toEqual([]);
  });
});

describe('getSpecRoutes', () => {
  let dir;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  it('extracts all method+path combos from OpenAPI paths', () => {
    const specPath = writeSpec(dir, {
      '/v1/health': { get: { summary: 'health' } },
      '/v1/quote': { post: { summary: 'quote' } },
    });
    const routes = getSpecRoutes(specPath);
    expect(routes).toEqual(['GET /v1/health', 'POST /v1/quote']);
  });

  it('handles multiple methods on one path', () => {
    const specPath = writeSpec(dir, {
      '/dashboard/routes': {
        get: { summary: 'list' },
        put: { summary: 'upsert' },
        delete: { summary: 'remove' },
      },
    });
    const routes = getSpecRoutes(specPath);
    expect(routes).toEqual([
      'DELETE /dashboard/routes',
      'GET /dashboard/routes',
      'PUT /dashboard/routes',
    ]);
  });

  it('ignores non-HTTP keys like parameters', () => {
    const specPath = writeSpec(dir, {
      '/v1/resource': {
        post: { summary: 'resource' },
        parameters: [{ in: 'header', name: 'X-PAYMENT' }],
      },
    });
    const routes = getSpecRoutes(specPath);
    expect(routes).toEqual(['POST /v1/resource']);
  });

  it('returns empty array when paths is empty', () => {
    const specPath = writeSpec(dir, {});
    expect(getSpecRoutes(specPath)).toEqual([]);
  });

  it('returns sorted results', () => {
    const specPath = writeSpec(dir, {
      '/z/last': { get: {} },
      '/a/first': { post: {} },
    });
    const routes = getSpecRoutes(specPath);
    expect(routes).toEqual(['GET /z/last', 'POST /a/first']);
  });

  it('throws on missing spec file', () => {
    expect(() => getSpecRoutes(resolve(dir, 'nope.yaml'))).toThrow();
  });
});

describe('getCodeRoutes', () => {
  let dir;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  it('extracts routes from routes/index.js and dashboard handler', () => {
    writeRouteFile(dir, 'src/routes/index.js', `const routes = { 'GET /v1/health': h };`);
    writeRouteFile(
      dir,
      'src/handlers/dashboard.handler.js',
      `const routes = { 'POST /dashboard/signup': s };`,
    );
    const routes = getCodeRoutes(dir);
    expect(routes).toContain('GET /v1/health');
    expect(routes).toContain('POST /dashboard/signup');
  });

  it('adds webhook route when handler exists', () => {
    writeRouteFile(dir, 'src/routes/index.js', '');
    writeRouteFile(dir, 'src/handlers/dashboard.handler.js', '');
    writeRouteFile(dir, 'src/handlers/webhook.handler.js', 'export const handler = () => {};');
    const routes = getCodeRoutes(dir);
    expect(routes).toContain('POST /v1/webhooks/{provider}');
  });

  it('adds stripe webhook route when handler exists', () => {
    writeRouteFile(dir, 'src/routes/index.js', '');
    writeRouteFile(dir, 'src/handlers/dashboard.handler.js', '');
    writeRouteFile(dir, 'src/handlers/stripe-webhook.handler.js', 'export default () => {};');
    const routes = getCodeRoutes(dir);
    expect(routes).toContain('POST /v1/webhooks/stripe');
  });

  it('omits webhook routes when handlers do not exist', () => {
    writeRouteFile(dir, 'src/routes/index.js', '');
    writeRouteFile(dir, 'src/handlers/dashboard.handler.js', '');
    const routes = getCodeRoutes(dir);
    expect(routes).not.toContain('POST /v1/webhooks/{provider}');
    expect(routes).not.toContain('POST /v1/webhooks/stripe');
  });

  it('deduplicates routes across files', () => {
    writeRouteFile(dir, 'src/routes/index.js', `const routes = { 'GET /shared': h };`);
    writeRouteFile(
      dir,
      'src/handlers/dashboard.handler.js',
      `const routes = { 'GET /shared': h };`,
    );
    const routes = getCodeRoutes(dir);
    expect(routes.filter((r) => r === 'GET /shared')).toHaveLength(1);
  });

  it('returns sorted results', () => {
    writeRouteFile(dir, 'src/routes/index.js', `const r = { 'POST /z': a, 'GET /a': b };`);
    writeRouteFile(dir, 'src/handlers/dashboard.handler.js', '');
    const routes = getCodeRoutes(dir);
    expect(routes).toEqual(['GET /a', 'POST /z']);
  });
});

describe('compareRoutes', () => {
  it('reports no drift when routes match', () => {
    const routes = ['GET /a', 'POST /b'];
    const result = compareRoutes(routes, routes);
    expect(result.inSpecNotCode).toEqual([]);
    expect(result.inCodeNotSpec).toEqual([]);
  });

  it('reports routes in spec but not code', () => {
    const result = compareRoutes(['GET /a', 'POST /b'], ['GET /a']);
    expect(result.inSpecNotCode).toEqual(['POST /b']);
    expect(result.inCodeNotSpec).toEqual([]);
  });

  it('reports routes in code but not spec', () => {
    const result = compareRoutes(['GET /a'], ['GET /a', 'DELETE /c']);
    expect(result.inSpecNotCode).toEqual([]);
    expect(result.inCodeNotSpec).toEqual(['DELETE /c']);
  });

  it('reports both directions of drift', () => {
    const result = compareRoutes(['GET /a', 'POST /b'], ['GET /a', 'PUT /c']);
    expect(result.inSpecNotCode).toEqual(['POST /b']);
    expect(result.inCodeNotSpec).toEqual(['PUT /c']);
  });

  it('handles empty inputs', () => {
    expect(compareRoutes([], [])).toEqual({ inSpecNotCode: [], inCodeNotSpec: [] });
  });

  it('all spec routes missing from code', () => {
    const result = compareRoutes(['GET /x'], []);
    expect(result.inSpecNotCode).toEqual(['GET /x']);
  });
});

describe('end-to-end against real codebase', () => {
  it('current openapi.yaml matches implemented routes (no drift)', () => {
    const specRoutes = getSpecRoutes(resolve(process.cwd(), 'openapi.yaml'));
    const codeRoutes = getCodeRoutes(process.cwd());
    const { inSpecNotCode, inCodeNotSpec } = compareRoutes(specRoutes, codeRoutes);
    expect(inSpecNotCode).toEqual([]);
    expect(inCodeNotSpec).toEqual([]);
  });

  it('detects drift when spec has extra route', () => {
    const dir = makeTmpDir();
    const specPath = writeSpec(dir, {
      '/v1/health': { get: {} },
      '/v1/new-thing': { post: {} },
    });
    writeRouteFile(dir, 'src/routes/index.js', `const r = { 'GET /v1/health': h };`);
    writeRouteFile(dir, 'src/handlers/dashboard.handler.js', '');

    const specRoutes = getSpecRoutes(specPath);
    const codeRoutes = getCodeRoutes(dir);
    const { inSpecNotCode } = compareRoutes(specRoutes, codeRoutes);
    expect(inSpecNotCode).toEqual(['POST /v1/new-thing']);
  });

  it('detects drift when code has extra route', () => {
    const dir = makeTmpDir();
    const specPath = writeSpec(dir, { '/v1/health': { get: {} } });
    writeRouteFile(
      dir,
      'src/routes/index.js',
      `const r = { 'GET /v1/health': h, 'POST /v1/extra': e };`,
    );
    writeRouteFile(dir, 'src/handlers/dashboard.handler.js', '');

    const specRoutes = getSpecRoutes(specPath);
    const codeRoutes = getCodeRoutes(dir);
    const { inCodeNotSpec } = compareRoutes(specRoutes, codeRoutes);
    expect(inCodeNotSpec).toEqual(['POST /v1/extra']);
  });
});
