import { paymentsRepo } from '../repositories/payments.repo.js';
import { fraudRepo } from '../repositories/fraud.repo.js';
import { tenantsRepo } from '../repositories/tenants.repo.js';

const PLAN_PRICES = { free: 0, starter: 49, growth: 99, scale: 299 };
const CACHE_TTL_MS = Number(process.env.METRICS_CACHE_TTL_MS) || 5 * 60 * 1000;

let cached = null;
let cacheExpiry = 0;

function aggregatePayments(payments) {
  let total402s = 0;
  let totalUsdcMicro = 0;
  let fetchesTotal = 0;
  let fetchUsdcMicro = 0;
  const tenantVolume = new Map();

  for (const p of payments) {
    total402s++;
    const amt = Number(p.amountWei) || 0;
    totalUsdcMicro += amt;

    if (p.resource === '/v1/fetch') {
      fetchesTotal++;
      fetchUsdcMicro += amt;
    }

    const acc = p.accountId;
    if (acc) {
      const entry = tenantVolume.get(acc) || { accountId: acc, paymentCount: 0, totalUsdcMicro: 0 };
      entry.paymentCount++;
      entry.totalUsdcMicro += amt;
      tenantVolume.set(acc, entry);
    }
  }

  const topTenants = [...tenantVolume.values()]
    .sort((a, b) => b.paymentCount - a.paymentCount)
    .slice(0, 10);

  return {
    total402s,
    totalUsdc: totalUsdcMicro / 1e6,
    fetchesTotal,
    fetchRevenueUsdc: fetchUsdcMicro / 1e6,
    topTenants,
  };
}

function countFraudByWindow(events) {
  const now = Date.now();
  const h24 = now - 24 * 3600_000;
  const d7 = now - 7 * 24 * 3600_000;
  let count24 = 0;
  let count7d = 0;
  const count30d = events.length;

  for (const e of events) {
    const ts = new Date(e.timestamp).getTime();
    if (ts >= h24) count24++;
    if (ts >= d7) count7d++;
  }

  return { h24: count24, h7d: count7d, h30d: count30d };
}

async function computeRevenueStats() {
  let mrr = 0;
  let payingCount = 0;
  const mrrByPlan = { free: 0, starter: 0, growth: 0, scale: 0 };
  const countByPlan = { free: 0, starter: 0, growth: 0, scale: 0 };
  let lastKey;
  do {
    const { items, lastKey: next } = await tenantsRepo.listAll(100, lastKey);
    for (const t of items) {
      const plan = t.plan ?? 'free';
      const price = PLAN_PRICES[plan] ?? 0;
      countByPlan[plan] = (countByPlan[plan] ?? 0) + 1;
      if (price > 0 && (t.status ?? 'active') === 'active') {
        mrr += price;
        payingCount++;
        mrrByPlan[plan] = (mrrByPlan[plan] ?? 0) + price;
      }
    }
    lastKey = next;
  } while (lastKey);
  return { mrr, payingCount, mrrByPlan, countByPlan };
}

export const metricsService = {
  _resetCache() {
    cached = null;
    cacheExpiry = 0;
  },

  async getDashboard() {
    const now = Date.now();
    if (cached && now < cacheExpiry) return cached;

    const thirtyDaysAgo = new Date(now - 30 * 24 * 3600_000).toISOString();

    const [revenue, payments, fraudEvents] = await Promise.all([
      computeRevenueStats(),
      paymentsRepo.scanAllConfirmed(),
      fraudRepo.scanEventsSince(thirtyDaysAgo),
    ]);

    const paymentStats = aggregatePayments(payments);
    const fraudCounts = countFraudByWindow(fraudEvents);

    cached = {
      mrr: revenue.mrr,
      payingCount: revenue.payingCount,
      mrrByPlan: revenue.mrrByPlan,
      countByPlan: revenue.countByPlan,
      total402s: paymentStats.total402s,
      totalUsdc: paymentStats.totalUsdc,
      fetchesTotal: paymentStats.fetchesTotal,
      fetchRevenueUsdc: paymentStats.fetchRevenueUsdc,
      fraudCounts,
      topTenants: paymentStats.topTenants,
    };
    cacheExpiry = now + CACHE_TTL_MS;
    return cached;
  },
};
