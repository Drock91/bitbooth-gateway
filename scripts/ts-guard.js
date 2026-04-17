#!/usr/bin/env node
// Fails CI if any .ts, .tsx, or tsconfig*.json files are tracked by git.

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const TS_PATTERNS = ['*.ts', '*.tsx', 'tsconfig*.json'];

export function findTsFiles(rootDir) {
  const args = TS_PATTERNS.map((p) => `'${p}'`).join(' ');
  try {
    const out = execSync(`git ls-files ${args}`, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out
      .trim()
      .split('\n')
      .filter((f) => f.length > 0);
  } catch {
    return [];
  }
}

const isCli =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isCli) {
  const files = findTsFiles(root);

  console.log('=== TypeScript File Guard ===\n');

  if (files.length > 0) {
    console.log(
      `FAIL: ${files.length} TypeScript file(s) detected (project is pure JS per CLAUDE.md):`,
    );
    for (const f of files) console.log(`   - ${f}`);
    console.log();
    process.exit(1);
  }

  console.log('OK: No TypeScript files found.');
  process.exit(0);
}
