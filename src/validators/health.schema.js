import { z } from 'zod';

export const HealthCheckResult = z.object({
  name: z.string(),
  ok: z.boolean(),
  latencyMs: z.number().nonnegative(),
  error: z.string().optional(),
});

export const HealthReadyResponse = z.object({
  ok: z.boolean(),
  stage: z.string(),
  checks: z.array(HealthCheckResult),
});
