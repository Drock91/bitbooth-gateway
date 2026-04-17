#!/usr/bin/env node
// Validates that openapi.yaml paths match implemented routes in the codebase.
// Exits 0 when they match, 1 on drift.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head']);

export function getSpecRoutes(specPath) {
  const spec = yaml.load(readFileSync(specPath, 'utf8'));
  const routes = [];
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const method of Object.keys(methods)) {
      if (HTTP_METHODS.has(method)) {
        routes.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return routes.sort();
}

const ROUTE_KEY_RE = /['"]([A-Z]+)\s+(\/[^'"]*)['"]\s*:/g;

export function extractRouteKeys(source) {
  const keys = [];
  let m;
  while ((m = ROUTE_KEY_RE.exec(source)) !== null) {
    keys.push(`${m[1]} ${m[2]}`);
  }
  ROUTE_KEY_RE.lastIndex = 0;
  return keys;
}

export function getCodeRoutes(rootDir) {
  const routes = new Set();

  const routeFiles = [
    resolve(rootDir, 'src/routes/index.js'),
    resolve(rootDir, 'src/handlers/dashboard.handler.js'),
  ];

  for (const file of routeFiles) {
    if (existsSync(file)) {
      for (const key of extractRouteKeys(readFileSync(file, 'utf8'))) {
        routes.add(key);
      }
    }
  }

  if (existsSync(resolve(rootDir, 'src/handlers/webhook.handler.js'))) {
    routes.add('POST /v1/webhooks/{provider}');
  }

  if (existsSync(resolve(rootDir, 'src/handlers/stripe-webhook.handler.js'))) {
    routes.add('POST /v1/webhooks/stripe');
  }

  // /v1/fetch has its own dedicated handler bundle (fetch.handler.js) to keep
  // jsdom + readability out of the api.js bundle (esbuild can't resolve
  // jsdom's static asset paths). API GW routes /v1/fetch -> fetchFn directly.
  if (existsSync(resolve(rootDir, 'src/handlers/fetch.handler.js'))) {
    routes.add('POST /v1/fetch');
  }

  return [...routes].sort();
}

export function compareRoutes(specRoutes, codeRoutes) {
  const specSet = new Set(specRoutes);
  const codeSet = new Set(codeRoutes);
  return {
    inSpecNotCode: specRoutes.filter((r) => !codeSet.has(r)),
    inCodeNotSpec: codeRoutes.filter((r) => !specSet.has(r)),
  };
}

// CLI entrypoint
const isCli =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isCli) {
  const specRoutes = getSpecRoutes(resolve(root, 'openapi.yaml'));
  const codeRoutes = getCodeRoutes(root);
  const { inSpecNotCode, inCodeNotSpec } = compareRoutes(specRoutes, codeRoutes);

  let exitCode = 0;

  console.log('=== OpenAPI <-> Code Route Validation ===\n');
  console.log(`Spec routes:  ${specRoutes.length}`);
  console.log(`Code routes:  ${codeRoutes.length}\n`);

  if (inSpecNotCode.length) {
    exitCode = 1;
    console.log('DRIFT: In OpenAPI spec but NOT in code:');
    for (const r of inSpecNotCode) console.log(`   - ${r}`);
    console.log();
  }

  if (inCodeNotSpec.length) {
    exitCode = 1;
    console.log('DRIFT: In code but NOT in OpenAPI spec:');
    for (const r of inCodeNotSpec) console.log(`   - ${r}`);
    console.log();
  }

  if (exitCode === 0) {
    console.log('OK: All routes match.');
  }

  process.exit(exitCode);
}
