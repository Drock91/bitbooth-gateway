import { enforceX402 } from '../middleware/x402.middleware.js';
import { paymentsRepo } from '../repositories/payments.repo.js';

export const paymentsService = {
  async requirePayment(input) {
    return enforceX402(input);
  },

  async listPayments(accountId, { limit = 20, cursor } = {}) {
    const startKey = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()) : undefined;

    const { items, lastKey } = await paymentsRepo.listByAccount(accountId, limit, startKey);

    const nextCursor = lastKey ? Buffer.from(JSON.stringify(lastKey)).toString('base64url') : null;

    return { payments: items, nextCursor };
  },
};
