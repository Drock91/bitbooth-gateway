#!/usr/bin/env node
/**
 * patch-north-star.js — increment NORTH_STAR counters after a successful
 * first-402 smoke run.  Reads the smoke output JSON from stdin or a file,
 * bumps real_402_issued_count and real_usdc_settled_count, and writes the
 * updated .agent/NORTH_STAR.json back to disk.
 *
 * Usage:
 *   node scripts/smoke/first-402.js | node scripts/smoke/patch-north-star.js
 *   node scripts/smoke/patch-north-star.js --file result.json
 *   node scripts/smoke/patch-north-star.js --dry-run < result.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NORTH_STAR_PATH = resolve(__dirname, '../../.agent/NORTH_STAR.json');

function parseArgs(argv) {
  const args = { dryRun: false, file: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--file' && argv[i + 1]) args.file = argv[++i];
  }
  return args;
}

function readInput(filePath) {
  if (filePath) return readFileSync(filePath, 'utf-8');
  return readFileSync(0, 'utf-8');
}

export function parseEvidence(raw) {
  const data = JSON.parse(raw);
  if (!data.ok) throw new Error('smoke result .ok is falsy — refusing to patch');
  if (!data.txHash) throw new Error('smoke result missing txHash');
  if (!data.blockNumber) throw new Error('smoke result missing blockNumber');
  return data;
}

export function patchNorthStar(northStarPath, evidence, { dryRun = false } = {}) {
  const ns = JSON.parse(readFileSync(northStarPath, 'utf-8'));

  const prev402 = ns.real_402_issued_count ?? 0;
  const prevSettled = ns.real_usdc_settled_count ?? 0;

  ns.real_402_issued_count = prev402 + 1;
  ns.real_usdc_settled_count = prevSettled + 1;
  ns.last_updated = new Date().toISOString();

  if (!ns.evidence_log) ns.evidence_log = [];
  ns.evidence_log.push({
    type: 'first-402-nightly',
    txHash: evidence.txHash,
    blockNumber: evidence.blockNumber,
    resource: evidence.resource,
    accountId: evidence.accountId,
    amountWei: evidence.amountWei,
    at: new Date().toISOString(),
  });

  const output = JSON.stringify(ns, null, 2) + '\n';

  if (!dryRun) {
    writeFileSync(northStarPath, output, 'utf-8');
  }

  return {
    prev402,
    new402: ns.real_402_issued_count,
    prevSettled,
    newSettled: ns.real_usdc_settled_count,
    dryRun,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const raw = readInput(args.file);
  const evidence = parseEvidence(raw);
  const result = patchNorthStar(NORTH_STAR_PATH, evidence, { dryRun: args.dryRun });

  const tag = args.dryRun ? '[DRY-RUN]' : '[PATCHED]';
  process.stderr.write(`${tag} real_402_issued_count: ${result.prev402} → ${result.new402}\n`);
  process.stderr.write(
    `${tag} real_usdc_settled_count: ${result.prevSettled} → ${result.newSettled}\n`,
  );

  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`patch-north-star FAIL: ${err.message}\n`);
    process.exit(1);
  });
}
