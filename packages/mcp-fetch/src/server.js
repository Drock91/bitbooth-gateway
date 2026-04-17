import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createX402Client } from './x402-client.js';

export function createServer(opts = {}) {
  const client = createX402Client(opts);

  const server = new McpServer(
    { name: 'bitbooth-fetch', version: '1.0.0' },
    {
      instructions:
        'Fetches any URL and returns its content as markdown. ' +
        'Payments are handled automatically via the x402 protocol — ' +
        'the agent wallet pays USDC on Base for each fetch.',
    },
  );

  server.registerTool(
    'fetch',
    {
      title: 'Fetch URL',
      description:
        'Fetch a web page and return its content as clean markdown. ' +
        'Payment ($0.005 USDC on Base) is handled automatically.',
      inputSchema: {
        url: z.string().url().describe('The URL to fetch'),
        mode: z
          .enum(['fast', 'full'])
          .default('fast')
          .describe('fast: raw HTML→markdown. full: article extraction + markdown.'),
      },
    },
    async ({ url, mode }) => {
      try {
        const result = await client.fetchWithPayment(url, mode);

        const parts = [];
        if (result.title) parts.push(`# ${result.title}\n`);
        parts.push(result.markdown);
        if (result.metadata) {
          parts.push(
            `\n---\n_Fetched from ${result.metadata.url} at ${result.metadata.fetchedAt}` +
              ` (${result.metadata.contentLength} bytes${result.metadata.truncated ? ', truncated' : ''})_`,
          );
        }

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Fetch failed: ${err.message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}
