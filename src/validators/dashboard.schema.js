import { z } from 'zod';
import { AccountId } from './tenant.schema.js';

export const DashboardQuery = z.object({
  accountId: AccountId.optional(),
});
