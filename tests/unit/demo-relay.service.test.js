import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendNativeEth = vi.hoisted(() => vi.fn());
const mockGetAgentAddress = vi.hoisted(() => vi.fn());
const mockCreateRandomReceiver = vi.hoisted(() => vi.fn());
const mockConsume = vi.hoisted(() => vi.fn());
const mockGetConfig = vi.hoisted(() => vi.fn());

vi.mock('../../src/adapters/xrpl-evm/index.js', () => ({
  sendNativeEth: mockSendNativeEth,
  getAgentAddress: mockGetAgentAddress,
  createRandomReceiver: mockCreateRandomReceiver,
}));

vi.mock('../../src/repositories/rate-limit.repo.js', () => ({
  rateLimitRepo: { consume: mockConsume },
}));

vi.mock('../../src/lib/config.js', () => ({
  getConfig: mockGetConfig,
}));

vi.mock('../../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runDemoRelay } from '../../src/services/demo-relay.service.js';
import { TooManyRequestsError } from '../../src/lib/errors.js';

describe('runDemoRelay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({ chain: { chainId: 84532 } });
    mockGetAgentAddress.mockResolvedValue('0xAGENT0000000000000000000000000000000DEAD');
    mockCreateRandomReceiver.mockReturnValue({
      address: '0xfeedfacecafebeef0000000000000000deadbeef',
    });
  });

  it('happy path: rate-limit grants, sends 1 wei, returns receipt + explorer', async () => {
    mockConsume.mockResolvedValue({ tokens: 0 });
    mockSendNativeEth.mockResolvedValue({
      hash: '0xdeadbeef',
      blockNumber: 12345,
      gasUsed: '21000',
      from: '0xAGENT0000000000000000000000000000000DEAD',
      to: '0xRECEIVER',
    });

    const result = await runDemoRelay({ sourceIp: '1.2.3.4' });

    expect(mockConsume).toHaveBeenCalledWith('demo-relay:1.2.3.4', 3, 1 / 10);
    expect(mockSendNativeEth).toHaveBeenCalledWith({
      to: '0xfeedfacecafebeef0000000000000000deadbeef',
      valueWei: 1n,
    });
    expect(result.hash).toBe('0xdeadbeef');
    expect(result.blockNumber).toBe(12345);
    expect(result.chainId).toBe(84532);
    expect(result.chain).toBe('Base Sepolia');
    expect(result.explorerUrl).toBe('https://sepolia.basescan.org/tx/0xdeadbeef');
    expect(result.from).toBe('0xAGENT0000000000000000000000000000000DEAD');
    expect(result.valueWei).toBe('1');
    expect(result.receiverAddr).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('rate limit exhausted -> throws TooManyRequestsError', async () => {
    mockConsume.mockResolvedValue(null);

    await expect(runDemoRelay({ sourceIp: '5.6.7.8' })).rejects.toThrow(TooManyRequestsError);
    expect(mockSendNativeEth).not.toHaveBeenCalled();
  });

  it('uses unknown ip key when sourceIp missing', async () => {
    mockConsume.mockResolvedValue({ tokens: 0 });
    mockSendNativeEth.mockResolvedValue({
      hash: '0xabc',
      blockNumber: 1,
      gasUsed: '21000',
      from: '0xAGENT',
      to: '0xR',
    });

    await runDemoRelay({});
    expect(mockConsume).toHaveBeenCalledWith('demo-relay:unknown', 3, 1 / 10);
  });

  it('Base mainnet chainId returns mainnet explorer + label', async () => {
    mockGetConfig.mockReturnValue({ chain: { chainId: 8453 } });
    mockConsume.mockResolvedValue({ tokens: 0 });
    mockSendNativeEth.mockResolvedValue({
      hash: '0xfeedface',
      blockNumber: 99,
      gasUsed: '21000',
      from: '0xA',
      to: '0xB',
    });

    const result = await runDemoRelay({ sourceIp: '9.9.9.9' });
    expect(result.chain).toBe('Base');
    expect(result.explorerUrl).toBe('https://basescan.org/tx/0xfeedface');
  });

  it('unknown chainId falls back to generic label + basescan', async () => {
    mockGetConfig.mockReturnValue({ chain: { chainId: 999 } });
    mockConsume.mockResolvedValue({ tokens: 0 });
    mockSendNativeEth.mockResolvedValue({
      hash: '0x1',
      blockNumber: 1,
      gasUsed: '21000',
      from: '0xA',
      to: '0xB',
    });
    const result = await runDemoRelay({ sourceIp: 'x' });
    expect(result.chain).toBe('EVM 999');
    expect(result.explorerUrl).toBe('https://basescan.org/tx/0x1');
  });

  it('propagates send errors (no rate-limit refund — single-attempt)', async () => {
    mockConsume.mockResolvedValue({ tokens: 0 });
    mockSendNativeEth.mockRejectedValue(new Error('chain reverted'));

    await expect(runDemoRelay({ sourceIp: '1.1.1.1' })).rejects.toThrow('chain reverted');
  });
});
