import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', 'package.json');
const serverJsonPath = resolve(__dirname, '..', 'server.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const serverJson = JSON.parse(readFileSync(serverJsonPath, 'utf8'));

describe('MCP Registry: package.json', () => {
  it('has mcpName property', () => {
    expect(pkg.mcpName).toBeDefined();
    expect(typeof pkg.mcpName).toBe('string');
  });

  it('mcpName starts with io.github. namespace', () => {
    expect(pkg.mcpName).toMatch(/^io\.github\.\w+\//);
  });

  it('includes server.json in files array', () => {
    expect(pkg.files).toContain('server.json');
  });

  it('has required npm fields for registry validation', () => {
    expect(pkg.name).toBeDefined();
    expect(pkg.version).toBeDefined();
    expect(pkg.description).toBeDefined();
    expect(pkg.repository).toBeDefined();
    expect(pkg.repository.url).toMatch(/^https:\/\/github\.com\//);
  });
});

describe('MCP Registry: server.json', () => {
  it('has $schema pointing to MCP server schema', () => {
    expect(serverJson.$schema).toContain('modelcontextprotocol.io/schemas');
    expect(serverJson.$schema).toContain('server.schema.json');
  });

  it('name matches mcpName in package.json', () => {
    expect(serverJson.name).toBe(pkg.mcpName);
  });

  it('has a description', () => {
    expect(serverJson.description).toBeDefined();
    expect(serverJson.description.length).toBeGreaterThan(10);
  });

  it('has repository with github source', () => {
    expect(serverJson.repository).toBeDefined();
    expect(serverJson.repository.url).toMatch(/^https:\/\/github\.com\//);
    expect(serverJson.repository.source).toBe('github');
  });

  it('version matches package.json version', () => {
    expect(serverJson.version).toBe(pkg.version);
  });

  it('has exactly one npm package entry', () => {
    expect(serverJson.packages).toHaveLength(1);
    expect(serverJson.packages[0].registryType).toBe('npm');
  });

  it('package identifier matches npm package name', () => {
    expect(serverJson.packages[0].identifier).toBe(pkg.name);
  });

  it('package version matches package.json version', () => {
    expect(serverJson.packages[0].version).toBe(pkg.version);
  });

  it('transport is stdio', () => {
    expect(serverJson.packages[0].transport).toEqual({ type: 'stdio' });
  });

  it('declares BITBOOTH_AGENT_KEY as required secret', () => {
    const envVars = serverJson.packages[0].environmentVariables;
    const agentKey = envVars.find((v) => v.name === 'BITBOOTH_AGENT_KEY');
    expect(agentKey).toBeDefined();
    expect(agentKey.isRequired).toBe(true);
    expect(agentKey.isSecret).toBe(true);
  });

  it('declares BITBOOTH_API_URL as optional', () => {
    const envVars = serverJson.packages[0].environmentVariables;
    const apiUrl = envVars.find((v) => v.name === 'BITBOOTH_API_URL');
    expect(apiUrl).toBeDefined();
    expect(apiUrl.isRequired).toBe(false);
    expect(apiUrl.isSecret).toBe(false);
  });

  it('declares BITBOOTH_CHAIN_ID as optional (testnet default, mainnet opt-in)', () => {
    const envVars = serverJson.packages[0].environmentVariables;
    const chainId = envVars.find((v) => v.name === 'BITBOOTH_CHAIN_ID');
    expect(chainId).toBeDefined();
    expect(chainId.isRequired).toBe(false);
    expect(chainId.isSecret).toBe(false);
  });

  it('all environment variables have description', () => {
    const envVars = serverJson.packages[0].environmentVariables;
    for (const v of envVars) {
      expect(v.description, `${v.name} missing description`).toBeDefined();
      expect(v.description.length).toBeGreaterThan(0);
    }
  });
});

describe('MCP Registry: npm-publish workflow', () => {
  const workflowPath = resolve(
    __dirname,
    '..',
    '..',
    '..',
    '.github',
    'workflows',
    'npm-publish.yml',
  );
  const workflow = readFileSync(workflowPath, 'utf8');

  it('includes mcp-publisher install step', () => {
    expect(workflow).toContain('mcp-publisher');
  });

  it('uses github-oidc authentication', () => {
    expect(workflow).toContain('login github-oidc');
  });

  it('has id-token write permission for OIDC', () => {
    expect(workflow).toContain('id-token: write');
  });

  it('publishes to MCP Registry after npm', () => {
    const npmPublishIdx = workflow.indexOf('npm publish');
    const mcpPublishIdx = workflow.indexOf('mcp-publisher publish');
    expect(npmPublishIdx).toBeGreaterThan(-1);
    expect(mcpPublishIdx).toBeGreaterThan(npmPublishIdx);
  });

  it('runs mcp-publisher publish from packages/mcp-fetch', () => {
    expect(workflow).toContain('working-directory: packages/mcp-fetch');
  });
});
