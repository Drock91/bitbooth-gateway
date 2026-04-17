import { tenantsRepo } from '../repositories/tenants.repo.js';
import { sha256, hmacSha256, safeEquals } from '../lib/crypto.js';
import { getSecret } from '../lib/secrets.js';
import { getConfig } from '../lib/config.js';
import { UnauthorizedError } from '../lib/errors.js';
import { fraudRepo } from '../repositories/fraud.repo.js';

const SESSION_TTL_MS = 15 * 60 * 1000;
const COOKIE_NAME = 'x402_admin_session';

const PLAN_PRICES = { free: 0, starter: 49, growth: 99, scale: 299 };

async function getSessionSecret() {
  const arn = getConfig().secretArns.adminApiKeyHash;
  if (!arn) throw new Error('Admin session secret not configured');
  return getSecret(arn);
}

export const adminService = {
  COOKIE_NAME,
  SESSION_TTL_MS,

  async listTenants({ limit = 20, cursor, plan } = {}) {
    const startKey = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()) : undefined;

    const { items, lastKey } = await tenantsRepo.listAll(limit, startKey, plan);

    const nextCursor = lastKey ? Buffer.from(JSON.stringify(lastKey)).toString('base64url') : null;

    return { tenants: items, nextCursor };
  },

  async verifyAdminKey(password) {
    const arn = getConfig().secretArns.adminApiKeyHash;
    if (!arn) throw new UnauthorizedError('Admin access not configured');
    const expected = await getSecret(arn);
    if (!safeEquals(sha256(password), expected)) {
      throw new UnauthorizedError('Invalid admin credentials');
    }
  },

  async createSessionCookie() {
    const secret = await getSessionSecret();
    const exp = Date.now() + SESSION_TTL_MS;
    const payload = JSON.stringify({ role: 'admin', exp });
    const encoded = Buffer.from(payload).toString('base64url');
    const sig = hmacSha256(secret, encoded);
    const value = `${encoded}.${sig}`;

    return {
      name: COOKIE_NAME,
      value,
      options: [
        `${COOKIE_NAME}=${value}`,
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
        'Path=/',
        `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
      ].join('; '),
    };
  },

  async validateSession(cookieHeader) {
    if (!cookieHeader) throw new UnauthorizedError('No admin session');

    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
    if (!match) throw new UnauthorizedError('No admin session cookie');

    const parts = match[1].split('.');
    const encoded = parts[0];
    const sig = parts[1];
    if (!encoded || !sig) throw new UnauthorizedError('Malformed admin session');

    const secret = await getSessionSecret();
    const expected = hmacSha256(secret, encoded);
    if (!safeEquals(sig, expected)) throw new UnauthorizedError('Invalid admin session signature');

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (payload.role !== 'admin') throw new UnauthorizedError('Invalid admin session role');
    if (!payload.exp || Date.now() > payload.exp) {
      throw new UnauthorizedError('Admin session expired');
    }

    const refreshed = await this.createSessionCookie();
    return { role: 'admin', refreshCookie: refreshed.options };
  },

  clearCookie() {
    return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
  },

  async getRevenueStats() {
    let mrr = 0;
    let payingCount = 0;
    let lastKey;
    do {
      const { items, lastKey: next } = await tenantsRepo.listAll(100, lastKey);
      for (const t of items) {
        const price = PLAN_PRICES[t.plan] ?? 0;
        if (price > 0 && (t.status ?? 'active') === 'active') {
          mrr += price;
          payingCount++;
        }
      }
      lastKey = next;
    } while (lastKey);
    return { mrr, payingCount };
  },

  async auditLog(action, details) {
    await fraudRepo.recordEvent({
      accountId: 'admin',
      eventType: `admin.${action}`,
      severity: 'info',
      details,
    });
  },
};
