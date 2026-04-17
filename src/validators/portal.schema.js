import { z } from 'zod';

export const PortalLoginBody = z.object({
  email: z.string().email().max(320),
  apiKey: z.string().min(1).max(256),
});
