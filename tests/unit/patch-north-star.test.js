import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { patchNorthStar, parseEvidence } from '../../scripts/smoke/patch-north-star.js';

function makeNorthStar(overrides = {}) {
  return {
    schemaVersion: 1,
    real_402_issued_count: 2,
    real_usdc_settled_count: 1,
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
    txHash: '0xabc123',
    blockNumber: 12345,
    resource: '/v1/resource',
    accountId: 'test-account-1',
    amountWei: '10000',
    ...overrides,
  };
}

describe('scripts/smoke/patch-north-star.js', () => {
  let tmpDir;
  let nsPath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ns-test-'));
    nsPath = join(tmpDir, 'NORTH_STAR.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('increments real_402_issued_count by 1', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar({ real_402_issued_count: 5 })));
    const result = patchNorthStar(nsPath, makeEvidence());
    expect(result.prev402).toBe(5);
    expect(result.new402).toBe(6);
  });

  it('increments real_usdc_settled_count by 1', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar({ real_usdc_settled_count: 3 })));
    const result = patchNorthStar(nsPath, makeEvidence());
    expect(result.prevSettled).toBe(3);
    expect(result.newSettled).toBe(4);
  });

  it('writes updated JSON to disk', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    patchNorthStar(nsPath, makeEvidence());
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    expect(written.real_402_issued_count).toBe(3);
    expect(written.real_usdc_settled_count).toBe(2);
  });

  it('does not write to disk in dry-run mode', () => {
    const original = makeNorthStar();
    writeFileSync(nsPath, JSON.stringify(original));
    const result = patchNorthStar(nsPath, makeEvidence(), { dryRun: true });
    expect(result.dryRun).toBe(true);
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    expect(written.real_402_issued_count).toBe(2);
  });

  it('updates last_updated timestamp', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    patchNorthStar(nsPath, makeEvidence());
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    expect(written.last_updated).not.toBe('2026-01-01T00:00:00Z');
    expect(new Date(written.last_updated).getFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it('appends to evidence_log array', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    patchNorthStar(nsPath, makeEvidence({ txHash: '0xfirst' }));
    patchNorthStar(nsPath, makeEvidence({ txHash: '0xsecond' }));
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    expect(written.evidence_log).toHaveLength(2);
    expect(written.evidence_log[0].txHash).toBe('0xfirst');
    expect(written.evidence_log[1].txHash).toBe('0xsecond');
  });

  it('creates evidence_log array if missing', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    patchNorthStar(nsPath, makeEvidence());
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    expect(Array.isArray(written.evidence_log)).toBe(true);
    expect(written.evidence_log).toHaveLength(1);
  });

  it('preserves existing evidence_log entries', () => {
    const ns = makeNorthStar();
    ns.evidence_log = [{ type: 'manual', txHash: '0xold' }];
    writeFileSync(nsPath, JSON.stringify(ns));
    patchNorthStar(nsPath, makeEvidence({ txHash: '0xnew' }));
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    expect(written.evidence_log).toHaveLength(2);
    expect(written.evidence_log[0].txHash).toBe('0xold');
    expect(written.evidence_log[1].txHash).toBe('0xnew');
  });

  it('evidence entry includes all fields', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    const ev = makeEvidence({
      txHash: '0xaaa',
      blockNumber: 999,
      resource: '/v1/test',
      accountId: 'acc-1',
      amountWei: '5000',
    });
    patchNorthStar(nsPath, ev);
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    const entry = written.evidence_log[0];
    expect(entry.type).toBe('first-402-nightly');
    expect(entry.txHash).toBe('0xaaa');
    expect(entry.blockNumber).toBe(999);
    expect(entry.resource).toBe('/v1/test');
    expect(entry.accountId).toBe('acc-1');
    expect(entry.amountWei).toBe('5000');
    expect(entry.at).toBeDefined();
  });

  it('handles zero counters gracefully', () => {
    writeFileSync(
      nsPath,
      JSON.stringify(makeNorthStar({ real_402_issued_count: 0, real_usdc_settled_count: 0 })),
    );
    const result = patchNorthStar(nsPath, makeEvidence());
    expect(result.new402).toBe(1);
    expect(result.newSettled).toBe(1);
  });

  it('handles missing counter fields (defaults to 0)', () => {
    const ns = makeNorthStar();
    delete ns.real_402_issued_count;
    delete ns.real_usdc_settled_count;
    writeFileSync(nsPath, JSON.stringify(ns));
    const result = patchNorthStar(nsPath, makeEvidence());
    expect(result.prev402).toBe(0);
    expect(result.new402).toBe(1);
    expect(result.prevSettled).toBe(0);
    expect(result.newSettled).toBe(1);
  });

  it('preserves other NORTH_STAR fields', () => {
    const ns = makeNorthStar({ deployed_staging: true, agent_wallet_address: '0x123' });
    writeFileSync(nsPath, JSON.stringify(ns));
    patchNorthStar(nsPath, makeEvidence());
    const written = JSON.parse(readFileSync(nsPath, 'utf-8'));
    expect(written.deployed_staging).toBe(true);
    expect(written.agent_wallet_address).toBe('0x123');
    expect(written.blockers).toEqual([]);
  });

  it('returns dryRun: false by default', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    const result = patchNorthStar(nsPath, makeEvidence());
    expect(result.dryRun).toBe(false);
  });

  it('throws on non-existent file', () => {
    expect(() => patchNorthStar('/tmp/does-not-exist.json', makeEvidence())).toThrow();
  });

  it('throws on invalid JSON in NORTH_STAR', () => {
    writeFileSync(nsPath, 'not valid json');
    expect(() => patchNorthStar(nsPath, makeEvidence())).toThrow();
  });

  it('output JSON is pretty-printed with trailing newline', () => {
    writeFileSync(nsPath, JSON.stringify(makeNorthStar()));
    patchNorthStar(nsPath, makeEvidence());
    const raw = readFileSync(nsPath, 'utf-8');
    expect(raw).toContain('\n');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.startsWith('{')).toBe(true);
  });
});

describe('parseEvidence', () => {
  it('parses valid evidence JSON', () => {
    const ev = parseEvidence(JSON.stringify({ ok: true, txHash: '0xabc', blockNumber: 1 }));
    expect(ev.txHash).toBe('0xabc');
    expect(ev.blockNumber).toBe(1);
  });

  it('rejects evidence with ok=false', () => {
    expect(() =>
      parseEvidence(JSON.stringify({ ok: false, txHash: '0x1', blockNumber: 1 })),
    ).toThrow('refusing to patch');
  });

  it('rejects evidence missing txHash', () => {
    expect(() => parseEvidence(JSON.stringify({ ok: true, blockNumber: 1 }))).toThrow(
      'missing txHash',
    );
  });

  it('rejects evidence missing blockNumber', () => {
    expect(() => parseEvidence(JSON.stringify({ ok: true, txHash: '0x1' }))).toThrow(
      'missing blockNumber',
    );
  });

  it('rejects invalid JSON', () => {
    expect(() => parseEvidence('not json')).toThrow();
  });

  it('passes through extra fields', () => {
    const ev = parseEvidence(
      JSON.stringify({ ok: true, txHash: '0x1', blockNumber: 1, extra: 'yes' }),
    );
    expect(ev.extra).toBe('yes');
  });
});
