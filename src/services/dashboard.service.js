import { randomUUID, randomBytes } from 'node:crypto';
import { sha256 } from '../lib/crypto.js';
import { tenantsRepo } from '../repositories/tenants.repo.js';
import { paymentsRepo } from '../repositories/payments.repo.js';
import { routesRepo } from '../repositories/routes.repo.js';
import { tenantSignup } from '../lib/metrics.js';

export const dashboardService = {
  async signup() {
    const accountId = randomUUID();
    const rawApiKey = `x402_${randomBytes(32).toString('hex')}`;
    const apiKeyHash = sha256(rawApiKey);

    const tenant = await tenantsRepo.create({ accountId, apiKeyHash, plan: 'free' });
    tenantSignup({ accountId: tenant.accountId, plan: tenant.plan });
    return { accountId: tenant.accountId, apiKey: rawApiKey, plan: tenant.plan };
  },

  async rotateKey(accountId) {
    const rawApiKey = `x402_${randomBytes(32).toString('hex')}`;
    const apiKeyHash = sha256(rawApiKey);
    await tenantsRepo.updateApiKeyHash(accountId, apiKeyHash);
    return { accountId, apiKey: rawApiKey };
  },

  async getRecentPayments(accountId, limit = 20) {
    const { items } = await paymentsRepo.listByAccount(accountId, limit);
    return items;
  },

  async upsertRoute(accountId, input) {
    try {
      return await routesRepo.update(accountId, input.path, input);
    } catch {
      return routesRepo.create({ tenantId: accountId, ...input });
    }
  },

  async removeRoute(accountId, path) {
    await routesRepo.delete(accountId, path);
  },

  async listRoutes(accountId) {
    return routesRepo.listByTenant(accountId);
  },
};
