import { z } from 'zod';
import { Plan } from './tenant.schema.js';

export const AdminTenantsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  plan: Plan.optional(),
});

export const AdminTenantsUIQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
  plan: Plan.optional(),
});

export const AdminLoginBody = z.object({
  password: z.string().min(1).max(256),
});

export const AdminChangePasswordBody = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(12).max(256),
    confirmPassword: z.string().min(12).max(256),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'New password and confirmation do not match',
    path: ['confirmPassword'],
  });
