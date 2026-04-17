#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../src/server.js';

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('bitbooth-fetch MCP server running on stdio');
