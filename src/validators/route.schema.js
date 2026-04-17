import { z } from 'zod';

export const TenantId = z.string().uuid();
export const RoutePath = z.string().min(1).max(512).regex(/^\//, 'Must start with /');
export const Asset = z.enum(['USDC']);

export const FraudRules = z
  .object({
    maxAmountWei: z.string().regex(/^\d+$/).optional(),
    velocityPerMinute: z.number().int().positive().optional(),
  })
  .optional();

export const CreateRouteInput = z.object({
  tenantId: TenantId,
  path: RoutePath,
  priceWei: z.string().regex(/^\d+$/, 'Must be a non-negative integer string'),
  asset: Asset.default('USDC'),
  fraudRules: FraudRules,
});

export const UpdateRouteInput = z.object({
  path: RoutePath,
  priceWei: z.string().regex(/^\d+$/, 'Must be a non-negative integer string'),
  asset: Asset.default('USDC'),
  fraudRules: FraudRules,
});

export const DeleteRouteInput = z.object({
  path: RoutePath,
});

export const RouteItem = z.object({
  tenantId: TenantId,
  path: RoutePath,
  priceWei: z.string().regex(/^\d+$/),
  asset: Asset,
  fraudRules: FraudRules,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
