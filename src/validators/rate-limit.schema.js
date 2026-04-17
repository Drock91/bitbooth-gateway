import { z } from 'zod';

// The `accountId` column is the DDB partition key for the shared bucket table.
// It stores real account UUIDs AND prefixed composite keys used by IP-based
// buckets: `health#<ip>`, `admin#<ip>`, `signup#<ip>`. A strict .uuid() check
// would 500 every public endpoint that does IP limiting, so we accept any
// non-empty string here and let the middleware decide the key shape.
export const RateLimitBucket = z.object({
  accountId: z.string().min(1),
  tokens: z.number().min(0),
  lastRefillAt: z.string().datetime(),
  capacity: z.number().int().positive(),
  refillRate: z.number().positive(),
});
