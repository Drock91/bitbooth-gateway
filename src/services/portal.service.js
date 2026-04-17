import { sha256, hmacSha256, safeEquals } from '../lib/crypto.js';
import { tenantsRepo } from '../repositories/tenants.repo.js';
import { getSecret } from '../lib/secrets.js';
import { getConfig } from '../lib/config.js';
import { UnauthorizedError } from '../lib/errors.js';

const SESSION_TTL_MS = 15 * 60 * 1000;
const COOKIE_NAME = 'x402_session';

async function getSessionSecret() {
  const arn = getConfig().secretArns.adminApiKeyHash;
  if (!arn) throw new Error('Session secret not configured (ADMIN_API_KEY_HASH_SECRET_ARN)');
  return getSecret(arn);
}

export const portalService = {
  async verifyApiKey(apiKey) {
    const hash = sha256(apiKey);
    const tenant = await tenantsRepo.getByApiKeyHash(hash);
    if (!tenant) throw new UnauthorizedError('Invalid API key');
    return tenant;
  },

  async createSessionCookie(accountId, plan) {
    const secret = await getSessionSecret();
    const exp = Date.now() + SESSION_TTL_MS;
    const payload = JSON.stringify({ accountId, plan, exp });
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
    if (!cookieHeader) throw new UnauthorizedError('No session');

    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
    if (!match) throw new UnauthorizedError('No session cookie');

    const [encoded, sig] = match[1].split('.');
    if (!encoded || !sig) throw new UnauthorizedError('Malformed session');

    const secret = await getSessionSecret();
    const expected = hmacSha256(secret, encoded);
    if (!safeEquals(sig, expected)) throw new UnauthorizedError('Invalid session signature');

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) {
      throw new UnauthorizedError('Session expired');
    }

    return { accountId: payload.accountId, plan: payload.plan };
  },

  clearCookie() {
    return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
  },

  COOKIE_NAME,
  SESSION_TTL_MS,
};
