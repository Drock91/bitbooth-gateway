import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetByTenantAndPath } = vi.hoisted(() => ({
  mockGetByTenantAndPath: vi.fn(),
}));
vi.mock('../../src/repositories/routes.repo.js', () => ({
  routesRepo: { getByTenantAndPath: mockGetByTenantAndPath },
}));

import { routesService } from '../../src/services/routes.service.js';

const TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('routesService — getRouteConfig', () => {
  beforeEach(() => {
    mockGetByTenantAndPath.mockReset();
  });

  it('returns route config mapped to x402 shape', async () => {
    mockGetByTenantAndPath.mockResolvedValueOnce({
      tenantId: TENANT_ID,
      path: '/v1/resource',
      priceWei: '5000000',
      asset: 'USDC',
    });
    const result = await routesService.getRouteConfig(TENANT_ID, '/v1/resource');
    expect(result).toEqual({
      resource: '/v1/resource',
      amountWei: '5000000',
      assetSymbol: 'USDC',
    });
  });

  it('propagates NotFoundError from repo', async () => {
    mockGetByTenantAndPath.mockRejectedValueOnce(new Error('Route not found'));
    await expect(routesService.getRouteConfig(TENANT_ID, '/missing')).rejects.toThrow(
      'Route not found',
    );
  });
});
