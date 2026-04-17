import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createX402Client } from './x402-client.js';

const DEFAULT_NAME = 'bitbooth_fetch';
const DEFAULT_DESCRIPTION =
  'Fetch a web page and return its content as clean markdown. ' +
  'Payment ($0.005 USDC on Base) is handled automatically via the x402 protocol. ' +
  'Use this whenever you need up-to-date public web content that the model does not already know.';

export const BitBoothFetchSchema = z.object({
  url: z.string().url().describe('The URL to fetch. Must be a fully qualified http(s) URL.'),
  mode: z
    .enum(['fast', 'full'])
    .default('fast')
    .describe(
      'fast: raw HTML converted to markdown. full: Mozilla Readability article extraction for cleaner output. Default: fast.',
    ),
});

function formatResult(result) {
  const parts = [];
  if (result?.title) parts.push(`# ${result.title}\n`);
  if (result?.markdown) parts.push(result.markdown);
  const meta = result?.metadata;
  if (meta) {
    const bytes = meta.contentLength != null ? `${meta.contentLength} bytes` : 'unknown size';
    const truncated = meta.truncated ? ', truncated' : '';
    parts.push(
      `\n---\n_Fetched from ${meta.url ?? 'unknown'} at ${meta.fetchedAt ?? 'unknown'} (${bytes}${truncated})_`,
    );
  }
  return parts.join('\n');
}

export function createBitBoothFetchTool(opts = {}) {
  const client = opts.client || createX402Client(opts);
  const name = opts.name || DEFAULT_NAME;
  const description = opts.description || DEFAULT_DESCRIPTION;

  return tool(
    async ({ url, mode }) => {
      const result = await client.fetchWithPayment(url, mode);
      return formatResult(result);
    },
    {
      name,
      description,
      schema: BitBoothFetchSchema,
    },
  );
}
