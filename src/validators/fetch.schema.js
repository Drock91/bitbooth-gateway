import { z } from 'zod';

// 'render' (Playwright) ships in v1.0.2 — the binary needs a Lambda Layer
// attached to the fetch function (@sparticuz/chromium). Until that layer is
// wired in CDK, render is gated to avoid charging agents for a broken endpoint.
export const FetchMode = z.enum(['fast', 'full']);

export const FetchRequest = z.object({
  url: z.string().url(),
  mode: FetchMode.default('fast'),
});

export const FetchMetadata = z.object({
  url: z.string().url(),
  fetchedAt: z.string().datetime(),
  contentLength: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

export const FetchResponse = z.object({
  title: z.string(),
  markdown: z.string(),
  metadata: FetchMetadata,
});

/** @typedef {z.infer<typeof FetchMode>} FetchMode */
/** @typedef {z.infer<typeof FetchRequest>} FetchRequest */
/** @typedef {z.infer<typeof FetchMetadata>} FetchMetadata */
/** @typedef {z.infer<typeof FetchResponse>} FetchResponse */
