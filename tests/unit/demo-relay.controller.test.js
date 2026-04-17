import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunDemoRelay = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/demo-relay.service.js', () => ({
  runDemoRelay: mockRunDemoRelay,
}));

import { postDemoRelay } from '../../src/controllers/demo-relay.controller.js';

describe('postDemoRelay', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 + service result + CORS headers on happy path', async () => {
    mockRunDemoRelay.mockResolvedValue({
      chain: 'Base Sepolia',
      chainId: 84532,
      hash: '0xabc',
      blockNumber: 100,
      gasUsed: '21000',
      from: '0xA',
      to: '0xB',
      receiverAddr: '0xB',
      valueWei: '1',
      explorerUrl: 'https://sepolia.basescan.org/tx/0xabc',
    });

    const event = {
      body: '{}',
      requestContext: { identity: { sourceIp: '7.7.7.7' } },
    };
    const resp = await postDemoRelay(event);

    expect(resp.statusCode).toBe(200);
    expect(resp.headers['access-control-allow-origin']).toBe('*');
    expect(resp.headers['access-control-allow-methods']).toBe('POST, OPTIONS');
    expect(JSON.parse(resp.body).hash).toBe('0xabc');
    expect(mockRunDemoRelay).toHaveBeenCalledWith({ sourceIp: '7.7.7.7' });
  });

  it('handles missing requestContext gracefully', async () => {
    mockRunDemoRelay.mockResolvedValue({
      hash: '0x1',
      blockNumber: 1,
      gasUsed: '21000',
      from: '0xA',
      to: '0xB',
      receiverAddr: '0xB',
      valueWei: '1',
      explorerUrl: 'https://sepolia.basescan.org/tx/0x1',
      chain: 'Base Sepolia',
      chainId: 84532,
    });
    const resp = await postDemoRelay({ body: '{}' });
    expect(resp.statusCode).toBe(200);
    expect(mockRunDemoRelay).toHaveBeenCalledWith({ sourceIp: 'unknown' });
  });

  it('rejects bodies with extra fields', async () => {
    mockRunDemoRelay.mockResolvedValue({});
    const event = {
      body: JSON.stringify({ amount: '1000' }),
      requestContext: { identity: { sourceIp: '1.1.1.1' } },
    };
    await expect(postDemoRelay(event)).rejects.toThrow();
    expect(mockRunDemoRelay).not.toHaveBeenCalled();
  });

  it('accepts empty/missing body string by defaulting to {}', async () => {
    mockRunDemoRelay.mockResolvedValue({
      hash: '0x1',
      blockNumber: 1,
      gasUsed: '21000',
      from: '0xA',
      to: '0xB',
      receiverAddr: '0xB',
      valueWei: '1',
      explorerUrl: 'x',
      chain: 'Base Sepolia',
      chainId: 84532,
    });
    const resp = await postDemoRelay({ requestContext: { identity: { sourceIp: 'x' } } });
    expect(resp.statusCode).toBe(200);
  });
});
