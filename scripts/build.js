#!/usr/bin/env node
// Lambda bundle: esbuild bundles each handler into dist/ for CDK `Code.fromAsset('dist')`.
import { rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';

const root = process.cwd();
const dist = path.join(root, 'dist');
const handlersDir = path.join(root, 'src', 'handlers');

// Clean dist/ (tolerate stubborn dirs like .bin symlink leftovers in containers).
try {
  await rm(dist, { recursive: true, force: true });
} catch {
  // Fallback: remove only the files/dirs we control; leave immovable dirs.
}
await mkdir(dist, { recursive: true });

// Discover all handler entry points — flatten name from "api.handler.js" → "api.js"
// so the Lambda handler spec becomes the unambiguous "api.handler" (one dot).
const entries = readdirSync(handlersDir)
  .filter((f) => f.endsWith('.handler.js'))
  .map((f) => ({
    in: path.join(handlersDir, f),
    out: f.replace(/\.handler\.js$/, ''),
  }));

if (entries.length === 0) {
  console.error('[build] No handler entry points found in src/handlers/');
  process.exit(1);
}

// Bundle each handler. AWS SDK v3 is external (provided by Lambda runtime).
const result = await esbuild.build({
  entryPoints: entries,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: dist,
  external: ['@aws-sdk/*'],
  minify: true,
  treeShaking: true,
  sourcemap: false,
  banner: {
    // Polyfill CJS require() + __dirname / __filename inside ESM output so
    // deps that do `require('node:os')` or read files relative to __dirname
    // keep working after bundling (some pino transports + ethers internals).
    js: [
      '// Bundled by esbuild — do not edit.',
      "import { createRequire as __x402CreateRequire } from 'node:module';",
      "import { fileURLToPath as __x402FileURLToPath } from 'node:url';",
      "import { dirname as __x402Dirname } from 'node:path';",
      'const require = __x402CreateRequire(import.meta.url);',
      'const __filename = __x402FileURLToPath(import.meta.url);',
      'const __dirname = __x402Dirname(__filename);',
    ].join('\n'),
  },
  logLevel: 'warning',
});

if (result.errors.length > 0) {
  console.error('[build] esbuild errors:', result.errors);
  process.exit(1);
}

// Minimal package.json so Lambda resolves ESM imports.
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await writeFile(
  path.join(dist, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module' }, null, 2),
);

// Ship openapi.yaml into the Lambda bundle so /openapi.yaml + /docs can serve
// it at runtime. load-openapi.js probes candidate paths at cold start.
try {
  const openapiSrc = path.join(root, 'openapi.yaml');
  const openapiDst = path.join(dist, 'openapi.yaml');
  const yaml = await readFile(openapiSrc, 'utf8');
  await writeFile(openapiDst, yaml);
  console.log(`[build]  openapi.yaml → ${(yaml.length / 1024).toFixed(1)} KB`);
} catch (err) {
  console.warn('[build] openapi.yaml copy failed:', err?.message);
}

// Report sizes.
const { statSync } = await import('node:fs');
let totalKb = 0;
for (const entry of entries) {
  const name = entry.out + '.js';
  const out = path.join(dist, name);
  const kb = (statSync(out).size / 1024).toFixed(1);
  totalKb += parseFloat(kb);
  console.log(`[build]  ${name} → ${kb} KB`);
}
console.log(`[build] total: ${totalKb.toFixed(1)} KB (${entries.length} handlers)`);
console.log('[build] dist/ ready');
