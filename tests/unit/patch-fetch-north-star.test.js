import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  patchFetchNorthStar,
  parseFetchEvidence,
} from '../../scripts/smoke/patch-fetch-north-star.js';

function makeNorthStar(overrides = {}) {
  return {
    schemaVersion: 1,
    real_402_issued_count: 2,
    real_usdc_settled_count: 1,
    lifetime_fetches: 0,
    lifetime_usdc_collected: 0,
    deployed_staging: true,
    deployed_prod: false,
    last_updated: '2026-01-01T00:00:00Z',
    blockers: [],
    blockers_resolved: [],
    ...overrides,
  };
}

function makeEvidence(overrides = {}) {
  return {
    ok: true,
    txHash: '0xfetchabc',
    blockNumber: 99999,
    resource: '/v1/fetch',
    targetUrl: 'https://example.com',
    accountId: 'test-account-1',
    amountWei: '5000',
    ...overrides,
  };
}

describe('scripts/smoke/patch-fetch-north-star.js', () => {
  let tmpDir;
  let nsPath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ns-fetch-test-'));
    nsPath = join(tmpDir, 'NORTH_STAR.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('increments lifetime_fetches by 1', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar({ lifetime_fetches: 5 })));
    const result = patchFetchNorthStar(nsPath, makeEvidence());
    expect(result.prevFetches).toBe(5);
    expect(result.newFetches).toBe(6);
  });

  it('increments lifetime_usdc_collected by amountWei', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar({ lifetime_usdc_collected: 100 })));
    const result = patchFetchNorthStar(nsPath, makeEvidence({ amountWei: '5000' }));
    expect(result.prevCollected).toBe(100);
    expect(result.newCollected).toBe(5100);
  });

  it('writes updated JSON to disk', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    patchFetchNorthStar(nsPath, makeEvidence());
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    expect(written.lifetime_fetches).toBe(1);
    expect(written.lifetime_usdc_collected).toBe(5000);
  });

  it('does not write to disk in dry-run mode', () => {
    const original = makeNorthStar();
    writeFileSync(nsPath, JSON.stringify(original));
    const result = patchFetchNorthStar(nsPath, makeEvidence(), { dryRun: true });
    expect(result.dryRun).toBe(true);
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    expect(written.lifetime_fetches).toBe(0);
  });

  it('updates last_updated timestamp', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    patchFetchNorthStar(nsPath, makeEvidence());
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    expect(written.last_updated).not.toBe('2026-01-01T00:00:00Z');
  });

  it('appends to evidence_log array', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    patchFetchNorthStar(nsPath, makeEvidence({ txHash: '0xfirst' }));
    patchFetchNorthStar(nsPath, makeEvidence({ txHash: '0xsecond' }));
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    expect(written.evidence_log).toHaveLength(2);
    expect(written.evidence_log[0].txHash).toBe('0xfirst');
    expect(written.evidence_log[1].txHash).toBe('0xsecond');
  });

  it('creates evidence_log array if missing', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    patchFetchNorthStar(nsPath, makeEvidence());
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    expect(Array.isArray(written.evidence_log)).toBe(true);
    expect(written.evidence_log).toHaveLength(1);
  });

  it('preserves existing evidence_log entries', () => {
    const ns = makeNorthStar();
    ns.evidence_log = [{ type: 'first-402-nightly', txHash: '0xold' }];
    writeFileSync(nsPath, JSON.stringify(ns));
    patchFetchNorthStar(nsPath, makeEvidence({ txHash: '0xnew' }));
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    expect(written.evidence_log).toHaveLength(2);
    expect(written.evidence_log[0].type).toBe('first-402-nightly');
    expect(written.evidence_log[1].type).toBe('fetch-nightly');
  });

  it('evidence entry includes all fetch-specific fields', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    const ev = makeEvidence({
      txHash: '0xfetch1',
      blockNumber: 777,
      targetUrl: 'https://test.dev',
      accountId: 'acc-2',
      amountWei: '3000',
    });
    patchFetchNorthStar(nsPath, ev);
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    const entry = written.evidence_log[0];
    expect(entry.type).toBe('fetch-nightly');
    expect(entry.txHash).toBe('0xfetch1');
    expect(entry.blockNumber).toBe(777);
    expect(entry.resource).toBe('/v1/fetch');
    expect(entry.targetUrl).toBe('https://test.dev');
    expect(entry.accountId).toBe('acc-2');
    expect(entry.amountWei).toBe('3000');
    expect(entry.at).toBeDefined();
  });

  it('handles zero counters gracefully', () => {
    writeFileSync(
      nsPath,
      JSON.stringify(makeNorthStar({ lifetime_fetches: 0, lifetime_usdc_collected: 0 })),
    );
    const result = patchFetchNorthStar(nsPath, makeEvidence());
    expect(result.newFetches).toBe(1);
    expect(result.newCollected).toBe(5000);
  });

  it('handles missing counter fields (defaults to 0)', () => {
    const ns = makeNorthStar();
    delete ns.lifetime_fetches;
    delete ns.lifetime_usdc_collected;
    writeFileSync(nsPath, JSON.stringify(ns));
    const result = patchFetchNorthStar(nsPath, makeEvidence());
    expect(result.prevFetches).toBe(0);
    expect(result.newFetches).toBe(1);
    expect(result.prevCollected).toBe(0);
    expect(result.newCollected).toBe(5000);
  });

  it('preserves other NORTH_STAR fields', () => {
    const ns = makeNorthStar({ deployed_staging: true, agent_wallet_address: '0x123' });
    writeFileSync(nsPath, JSON.stringify(ns));
    patchFetchNorthStar(nsPath, makeEvidence());
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    expect(written.deployed_staging).toBe(true);
    expect(written.agent_wallet_address).toBe('0x123');
    expect(written.real_402_issued_count).toBe(2);
  });

  it('returns dryRun: false by default', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    const result = patchFetchNorthStar(nsPath, makeEvidence());
    expect(result.dryRun).toBe(false);
  });

  it('throws on non-existent file', () => {
    expect(() => patchFetchNorthStar('/tmp/does-not-exist.json', makeEvidence())).toThrow();
  });

  it('throws on invalid JSON in NORTH_STAR', () => {
    writeFileSync(nsPath, 'not valid json');
    expect(() => patchFetchNorthStar(nsPath, makeEvidence())).toThrow();
  });

  it('output JSON is pretty-printed with trailing newline', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    patchFetchNorthStar(nsPath, makeEvidence());
    const raw = readFileSync(nsPath, 'utf-8');
    expect(raw).toContain('\n');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.startsWith('{')).toBe(true);
  });

  it('handles amountWei as undefined gracefully', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    const result = patchFetchNorthStar(nsPath, makeEvidence({ amountWei: undefined }));
    expect(result.newCollected).toBe(0);
  });
});

describe('parseFetchEvidence', () => {
  it('parses valid fetch evidence JSON', () => {
    const ev = parseFetchEvidence(
      JSON.stringify({ ok: true, txHash: '0xabc', blockNumber: 1, resource: '/v1/fetch' }),
    );
    expect(ev.txHash).toBe('0xabc');
    expect(ev.resource).toBe('/v1/fetch');
  });

  it('rejects evidence with ok=false', () => {
    expect(() =>
      parseFetchEvidence(
        JSON.stringify({ ok: false, txHash: '0x1', blockNumber: 1, resource: '/v1/fetch' }),
      ),
    ).toThrow('refusing to patch');
  });

  it('rejects evidence missing txHash', () => {
    expect(() =>
      parseFetchEvidence(JSON.stringify({ ok: true, blockNumber: 1, resource: '/v1/fetch' })),
    ).toThrow('missing txHash');
  });

  it('rejects evidence missing blockNumber', () => {
    expect(() =>
      parseFetchEvidence(JSON.stringify({ ok: true, txHash: '0x1', resource: '/v1/fetch' })),
    ).toThrow('missing blockNumber');
  });

  it('rejects evidence with wrong resource', () => {
    expect(() =>
      parseFetchEvidence(
        JSON.stringify({ ok: true, txHash: '0x1', blockNumber: 1, resource: '/v1/resource' }),
      ),
    ).toThrow('expected "/v1/fetch"');
  });

  it('rejects invalid JSON', () => {
    expect(() => parseFetchEvidence('not json')).toThrow();
  });

  it('passes through extra fields', () => {
    const ev = parseFetchEvidence(
      JSON.stringify({
        ok: true,
        txHash: '0x1',
        blockNumber: 1,
        resource: '/v1/fetch',
        extra: 'yes',
      }),
    );
    expect(ev.extra).toBe('yes');
  });
});
