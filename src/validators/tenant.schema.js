import { z } from 'zod';

export const AccountId = z.string().uuid();
export const ApiKeyHash = z.string().regex(/^[a-f0-9]{64}$/, 'Must be a SHA-256 hex digest');
export const Plan = z.enum(['free', 'starter', 'growth', 'scale']);
export const TenantStatus = z.enum(['active', 'suspended']).default('active');

export const CreateTenantInput = z.object({
  accountId: AccountId,
  apiKeyHash: ApiKeyHash,
  plan: Plan.default('free'),
  stripeCustomerId: z.string().min(1).max(128).optional(),
});

export const TenantItem = z.object({
  accountId: AccountId,
  apiKeyHash: ApiKeyHash,
  stripeCustomerId: z.string().optional(),
  plan: Plan,
  status: TenantStatus,
  createdAt: z.string().datetime(),
});
