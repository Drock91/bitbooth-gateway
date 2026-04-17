import { z } from 'zod';

export const FraudEventType = z.enum([
  'high_velocity',
  'repeated_nonce_failure',
  'abnormal_amount',
  'admin.login',
  'admin.logout',
  'admin.listTenants',
  'admin.listTenantsUI',
  'admin.suspendTenant',
  'admin.reactivateTenant',
  'admin.viewMetrics',
  'admin.changePassword',
]);

export const FraudEvent = z.object({
  accountId: z.string().min(1),
  timestamp: z.string().datetime(),
  eventType: FraudEventType,
  severity: z.enum(['info', 'low', 'medium', 'high']),
  details: z.record(z.unknown()),
  ttl: z.number().int().positive().optional(),
});

export const FraudTally = z.object({
  accountId: z.string().min(1),
  windowKey: z.string().min(1),
  eventCount: z.number().int().nonnegative(),
  lastEventAt: z.string().datetime().optional(),
});

export const VelocityWindow = z.object({
  maxPerMinute: z.number().int().positive(),
  maxPerHour: z.number().int().positive(),
});

export const AmountThresholds = z.object({
  minWei: z.string().regex(/^\d+$/).optional(),
  maxWei: z.string().regex(/^\d+$/).optional(),
});
