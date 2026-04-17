import { routesRepo } from '../repositories/routes.repo.js';

/**
 * Look up a route's pricing config and map it to the shape
 * the x402 middleware expects.
 *
 * @param {string} tenantId
 * @param {string} path  — the HTTP path (e.g. "/v1/resource")
 * @returns {Promise<{resource: string, amountWei: string, assetSymbol: string}>}
 */
export const routesService = {
  async getRouteConfig(tenantId, path) {
    const route = await routesRepo.getByTenantAndPath(tenantId, path);
    return {
      resource: route.path,
      amountWei: route.priceWei,
      assetSymbol: route.asset,
    };
  },
};
