import { z } from 'zod';

export const DemoSignupInput = z.object({
  email: z.string().trim().email().max(254),
});
