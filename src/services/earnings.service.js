import { paymentsRepo } from '../repositories/payments.repo.js';

/**
 * Aggregates the payments table into earnings stats for the admin dashboard.
 * Everything is derived on the fly (payments table is small — ~10k rows/month
 * on a successful BitBooth). At 100k+ payments per month we'd materialize
 * daily rollups in a separate table; until then this is fine.
 */

// CAIP-2 → pretty label + chain colour + testnet flag
const CHAIN_META = {
  'eip155:84532': { label: 'Base Sepolia', color: '#0052FF', unit: 'USDC', decimals: 6, isTestnet: true },
  'eip155:8453': { label: 'Base Mainnet', color: '#0052FF', unit: 'USDC', decimals: 6, isTestnet: false },
  'eip155:1440002': { label: 'XRPL EVM', color: '#7CF1A0', unit: 'USDC', decimals: 6, isTestnet: true },
  'xrpl:0': { label: 'XRPL Mainnet', color: '#23E5DB', unit: 'XRP', decimals: 6, isTestnet: false },
  'xrpl:1': { label: 'XRPL Testnet', color: '#23E5DB', unit: 'XRP', decimals: 6, isTestnet: true },
  'solana:mainnet': { label: 'Solana', color: '#14F195', unit: 'USDC', decimals: 6, isTestnet: false },
  'solana:devnet': { label: 'Solana Devnet', color: '#14F195', unit: 'USDC', decimals: 6, isTestnet: true },
  unknown: { label: 'Unknown', color: '#8888a0', unit: '—', decimals: 6, isTestnet: false },
};

function chainKey(p) {
  if (p.network) return p.network;
  if (p.assetSymbol === 'XRP' || p.assetSymbol === 'RLUSD') return 'xrpl:0';
  // XRPL tx hashes are 64 uppercase hex chars with no 0x prefix.
  // EVM tx hashes start with 0x. Use the hash shape as a fallback
  // for legacy records where `network` wasn't persisted.
  if (typeof p.txHash === 'string' && /^[0-9A-F]{64}$/.test(p.txHash)) return 'xrpl:0';
  return 'eip155:84532';
}

function toUnit(amountWei, decimals = 6) {
  const n = Number(BigInt(amountWei || '0')) / 10 ** decimals;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Bucket a Date into an hourly timestamp (UTC) for the sparkline.
 * @param {Date} d
 * @returns {string} ISO-8601 hour bucket
 */
function hourBucket(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()))
    .toISOString();
}

export { CHAIN_META };

export const earningsService = {
  /**
   * @param {{ mode?: 'real' | 'testnet' | 'all' }} [opts]
   */
  async summary(opts = {}) {
    const mode = opts.mode || 'real';
    const raw = await paymentsRepo.scanAllConfirmed();
    const all = mode === 'all'
      ? raw
      : raw.filter(p => {
        const net = chainKey(p);
        const meta = CHAIN_META[net] || CHAIN_META.unknown;
        return mode === 'testnet' ? meta.isTestnet : !meta.isTestnet;
      });
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const cutoff24h = now - DAY_MS;
    const cutoff7d = now - 7 * DAY_MS;
    const cutoff30d = now - 30 * DAY_MS;

    // Aggregations
    const byChain = {};
    const byAgent = {};
    const byResource = {};
    const sparkline = {};
    const recent = [];

    let totalPayments = 0;
    let totalLast24h = 0;
    let totalLast7d = 0;
    let totalLast30d = 0;

    for (const p of all) {
      const ts = new Date(p.confirmedAt || p.createdAt).getTime();
      if (!ts) continue;
      totalPayments++;

      const network = chainKey(p);
      const meta = CHAIN_META[network] || CHAIN_META.unknown;
      const value = toUnit(p.amountWei, meta.decimals);

      // By chain
      byChain[network] ||= { network, label: meta.label, color: meta.color, unit: meta.unit, isTestnet: Boolean(meta.isTestnet), count: 0, amount: 0 };
      byChain[network].count++;
      byChain[network].amount += value;

      // By agent (accountId)
      byAgent[p.accountId] ||= { accountId: p.accountId, count: 0, amount: 0, firstSeen: ts, lastSeen: 0 };
      byAgent[p.accountId].count++;
      byAgent[p.accountId].amount += value;
      if (ts > byAgent[p.accountId].lastSeen) byAgent[p.accountId].lastSeen = ts;
      if (ts < byAgent[p.accountId].firstSeen) byAgent[p.accountId].firstSeen = ts;

      // By resource (endpoint)
      const resource = p.resource || 'unknown';
      byResource[resource] ||= { resource, count: 0, amount: 0 };
      byResource[resource].count++;
      byResource[resource].amount += value;

      // Sparkline (hourly buckets, last 24h only)
      if (ts > cutoff24h) {
        const bucket = hourBucket(new Date(ts));
        sparkline[bucket] ||= { ts: bucket, count: 0, amount: 0 };
        sparkline[bucket].count++;
        sparkline[bucket].amount += value;
      }

      // Windowed totals
      if (ts > cutoff24h) totalLast24h += value;
      if (ts > cutoff7d) totalLast7d += value;
      if (ts > cutoff30d) totalLast30d += value;

      // Recent payments list (last 50)
      recent.push({
        txHash: p.txHash,
        network,
        chainLabel: meta.label,
        chainColor: meta.color,
        isTestnet: Boolean(meta.isTestnet),
        asset: p.assetSymbol || meta.unit,
        amount: value,
        accountId: p.accountId,
        resource,
        confirmedAt: p.confirmedAt || p.createdAt,
      });
    }

    recent.sort((a, b) => new Date(b.confirmedAt) - new Date(a.confirmedAt));
    const recentTop = recent.slice(0, 50);

    // Fill sparkline gaps (24 hourly buckets, newest first flipped to oldest→newest for chart)
    const sparklineArr = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now - i * 60 * 60 * 1000);
      const key = hourBucket(d);
      sparklineArr.push(sparkline[key] || { ts: key, count: 0, amount: 0 });
    }

    const byChainArr = Object.values(byChain).sort((a, b) => b.amount - a.amount);
    const byAgentArr = Object.values(byAgent).sort((a, b) => b.count - a.count).slice(0, 20);
    const byResourceArr = Object.values(byResource).sort((a, b) => b.count - a.count);

    return {
      generatedAt: new Date().toISOString(),
      mode,
      totals: {
        payments: totalPayments,
        uniqueAgents: Object.keys(byAgent).length,
        last24h: totalLast24h,
        last7d: totalLast7d,
        last30d: totalLast30d,
      },
      byChain: byChainArr,
      byAgent: byAgentArr,
      byResource: byResourceArr,
      sparkline: sparklineArr,
      recent: recentTop,
    };
  },
};
