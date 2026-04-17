import { UnauthorizedError } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { tenantsRepo } from '../repositories/tenants.repo.js';

/**
 * Authenticate via API key header. Hashes the key and looks up the tenant
 * in DDB via the apiKeyHash GSI.
 * @param {Record<string, string|undefined>} headers
 * @returns {Promise<{accountId: string}>}
 */
export async function authenticate(headers) {
  const apiKey = headers['x-api-key'] ?? headers['X-API-KEY'];
  if (!apiKey) throw new UnauthorizedError('missing api key');

  const hash = sha256(apiKey);
  const tenant = await tenantsRepo.getByApiKeyHash(hash);
  if (!tenant) throw new UnauthorizedError('invalid api key');

  return { accountId: tenant.accountId, plan: tenant.plan };
}
