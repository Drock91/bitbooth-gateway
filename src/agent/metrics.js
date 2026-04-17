/**
 * Compute project metrics used by state snapshots and the dashboard.
 */
import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'cdk.out', 'coverage', '.git'].includes(e.name)) continue;
      yield* walk(full);
    } else yield full;
  }
}

/**
 * Count `*.test.js` files under tests/.
 * @returns {Promise<number>}
 */
export async function countTestFiles(root = 'tests') {
  let n = 0;
  try {
    for await (const f of walk(root)) {
      if (f.endsWith('.test.js')) n++;
    }
  } catch {
    return 0;
  }
  return n;
}

/**
 * Count individual `it(...)` + `test(...)` calls across test files.
 * @returns {Promise<number>}
 */
export async function countTests(root = 'tests') {
  let n = 0;
  try {
    for await (const f of walk(root)) {
      if (!f.endsWith('.test.js')) continue;
      const src = await readFile(f, 'utf8');
      n += (src.match(/^\s*(it|test)\s*\(/gm) ?? []).length;
    }
  } catch {
    return 0;
  }
  return n;
}

/**
 * Parse the most recent vitest coverage summary JSON (if present).
 * @returns {Promise<number|null>}
 */
export async function readCoveragePct(summaryPath = 'coverage/coverage-summary.json') {
  try {
    const raw = await readFile(path.resolve(summaryPath), 'utf8');
    const data = JSON.parse(raw);
    return data.total?.lines?.pct ?? null;
  } catch {
    return null;
  }
}

/**
 * Total size of src/ in KB (rough bundle estimate).
 * @returns {Promise<number>}
 */
export async function srcSizeKb(root = 'src') {
  let bytes = 0;
  try {
    for await (const f of walk(root)) {
      const s = await stat(f);
      bytes += s.size;
    }
  } catch {
    return 0;
  }
  return Math.round(bytes / 1024);
}
