#!/usr/bin/env node
/**
 * patch-fetch-north-star.js — increment NORTH_STAR fetch counters after a
 * successful fetch-smoke run. Reads smoke output JSON from stdin or a file,
 * bumps lifetime_fetches (and lifetime_usdc_collected), and writes the
 * updated .agent/NORTH_STAR.json back to disk.
 *
 * Usage:
 *   node scripts/smoke/fetch-smoke.js | node scripts/smoke/patch-fetch-north-star.js
 *   node scripts/smoke/patch-fetch-north-star.js --file result.json
 *   node scripts/smoke/patch-fetch-north-star.js --dry-run < result.json
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

export function parseFetchEvidence(raw) {
  const data = JSON.parse(raw);
  if (!data.ok) throw new Error('smoke result .ok is falsy — refusing to patch');
  if (!data.txHash) throw new Error('smoke result missing txHash');
  if (!data.blockNumber) throw new Error('smoke result missing blockNumber');
  if (data.resource !== '/v1/fetch') {
    throw new Error(`smoke result resource is "${data.resource}", expected "/v1/fetch"`);
  }
  return data;
}

export function patchFetchNorthStar(northStarPath, evidence, { dryRun = false } = {}) {
  const ns = JSON.parse(readFileSync(northStarPath, 'utf-8'));

  const prevFetches = ns.lifetime_fetches ?? 0;
  const prevCollected = ns.lifetime_usdc_collected ?? 0;
  const amountMicro = Number(evidence.amountWei ?? 0);

  ns.lifetime_fetches = prevFetches + 1;
  ns.lifetime_usdc_collected = prevCollected + amountMicro;
  ns.last_updated = new Date().toISOString();

  if (!ns.evidence_log) ns.evidence_log = [];
  ns.evidence_log.push({
    type: 'fetch-nightly',
    txHash: evidence.txHash,
    blockNumber: evidence.blockNumber,
    resource: evidence.resource,
    targetUrl: evidence.targetUrl,
    accountId: evidence.accountId,
    amountWei: evidence.amountWei,
    at: new Date().toISOString(),
  });

  const output = JSON.stringify(ns, null, 2) + '\n';

  if (!dryRun) {
    writeFileSync(northStarPath, output, 'utf-8');
  }

  return {
    prevFetches,
    newFetches: ns.lifetime_fetches,
    prevCollected,
    newCollected: ns.lifetime_usdc_collected,
    dryRun,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const raw = readInput(args.file);
  const evidence = parseFetchEvidence(raw);
  const result = patchFetchNorthStar(NORTH_STAR_PATH, evidence, { dryRun: args.dryRun });

  const tag = args.dryRun ? '[DRY-RUN]' : '[PATCHED]';
  process.stderr.write(`${tag} lifetime_fetches: ${result.prevFetches} → ${result.newFetches}\n`);
  process.stderr.write(
    `${tag} lifetime_usdc_collected: ${result.prevCollected} → ${result.newCollected}\n`,
  );

  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`patch-fetch-north-star FAIL: ${err.message}\n`);
    process.exit(1);
  });
}
