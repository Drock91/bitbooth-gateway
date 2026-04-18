import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetDashboard = vi.fn();
const mockPostSignup = vi.fn();
const mockPostRotateKey = vi.fn();
const mockPutRoute = vi.fn();
const mockDeleteRoute = vi.fn();
const mockGetRoutes = vi.fn();

vi.mock('../../src/controllers/dashboard.controller.js', () => ({
  getDashboard: (...args) => mockGetDashboard(...args),
  postSignup: (...args) => mockPostSignup(...args),
  postRotateKey: (...args) => mockPostRotateKey(...args),
  putRoute: (...args) => mockPutRoute(...args),
  deleteRoute: (...args) => mockDeleteRoute(...args),
  getRoutes: (...args) => mockGetRoutes(...args),
}));
vi.mock('../../src/controllers/landing.controller.js', () => ({
  getLanding: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
  getFetch: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
  getDocs: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
  getAgentDocs: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
  getOpenapiYaml: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
}));
vi.mock('../../src/controllers/demo.controller.js', () => ({
  postDemoSignup: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
vi.mock('../../src/controllers/portal.controller.js', () => ({
  getPortal: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '<html>' }),
  postLogin: vi
    .fn()
    .mockResolvedValue({ statusCode: 303, headers: { location: '/portal/dashboard' }, body: '' }),
  getLogout: vi
    .fn()
    .mockResolvedValue({ statusCode: 303, headers: { location: '/portal' }, body: '' }),
  getPortalDashboard: vi
    .fn()
    .mockResolvedValue({ statusCode: 200, headers: {}, body: '<html>dash</html>' }),
  getPortalIntegrate: vi
    .fn()
    .mockResolvedValue({ statusCode: 200, headers: {}, body: '<html>integrate</html>' }),
  postPortalRotateKey: vi
    .fn()
    .mockResolvedValue({ statusCode: 200, headers: {}, body: '{"apiKey":"x402_new"}' }),
}));

const mockGetAdmin = vi.fn();
const mockPostAdminLogin = vi.fn();
const mockGetAdminLogout = vi.fn();
const mockListTenantsUI = vi.fn();
const mockGetAdminMetricsUI = vi.fn();
vi.mock('../../src/controllers/admin.login.controller.js', () => ({
  getAdmin: (...args) => mockGetAdmin(...args),
  postAdminLogin: (...args) => mockPostAdminLogin(...args),
  getAdminLogout: (...args) => mockGetAdminLogout(...args),
}));
vi.mock('../../src/controllers/admin.tenants.controller.js', () => ({
  listTenantsUI: (...args) => mockListTenantsUI(...args),
}));
vi.mock('../../src/controllers/admin.metrics.controller.js', () => ({
  getAdminMetricsUI: (...args) => mockGetAdminMetricsUI(...args),
}));
vi.mock('../../src/controllers/admin.password.controller.js', () => ({
  getAdminChangePassword: vi.fn().mockResolvedValue({ statusCode: 200, body: 'change-pw-page' }),
  postAdminChangePassword: vi.fn().mockResolvedValue({ statusCode: 200, body: 'updated' }),
}));
vi.mock('../../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  withCorrelation: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  flushLogger: vi.fn().mockResolvedValue(undefined),
}));

import { handler } from '../../src/handlers/dashboard.handler.js';

describe('dashboard.handler', () => {
  beforeEach(() => {
    mockGetDashboard.mockReset();
    mockPostSignup.mockReset();
    mockPostRotateKey.mockReset();
    mockPutRoute.mockReset();
    mockDeleteRoute.mockReset();
    mockGetRoutes.mockReset();
    mockGetAdmin.mockReset();
    mockPostAdminLogin.mockReset();
    mockGetAdminLogout.mockReset();
    mockListTenantsUI.mockReset();
    mockGetAdminMetricsUI.mockReset();
  });

  it('routes GET /dashboard to getDashboard', async () => {
    mockGetDashboard.mockResolvedValueOnce({ statusCode: 200, body: '<html>' });
    const res = await handler({ httpMethod: 'GET', path: '/dashboard', headers: {} });
    expect(res.statusCode).toBe(200);
    expect(mockGetDashboard).toHaveBeenCalledOnce();
  });

  it('routes POST /dashboard/signup to postSignup', async () => {
    mockPostSignup.mockResolvedValueOnce({ statusCode: 200, body: '<html>' });
    const res = await handler({ httpMethod: 'POST', path: '/dashboard/signup', headers: {} });
    expect(res.statusCode).toBe(200);
    expect(mockPostSignup).toHaveBeenCalledOnce();
  });

  it('returns 404 for unknown paths', async () => {
    const res = await handler({ httpMethod: 'GET', path: '/unknown', headers: {} });
    expect(res.statusCode).toBe(404);
  });

  it('returns 500 on unhandled controller error', async () => {
    mockGetDashboard.mockRejectedValueOnce(new Error('boom'));
    const res = await handler({ httpMethod: 'GET', path: '/dashboard', headers: {} });
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('Internal server error');
  });

  it('uses correlation ID from header', async () => {
    mockGetDashboard.mockResolvedValueOnce({ statusCode: 200, body: '' });
    await handler({
      httpMethod: 'GET',
      path: '/dashboard',
      headers: { 'x-correlation-id': 'test-corr-id' },
    });
    expect(mockGetDashboard).toHaveBeenCalledOnce();
  });

  it('routes POST /dashboard/rotate-key to postRotateKey', async () => {
    mockPostRotateKey.mockResolvedValueOnce({ statusCode: 200, body: '{}' });
    const res = await handler({ httpMethod: 'POST', path: '/dashboard/rotate-key', headers: {} });
    expect(res.statusCode).toBe(200);
    expect(mockPostRotateKey).toHaveBeenCalledOnce();
  });

  it('returns JSON error response when rotate-key throws AppError', async () => {
    const { AppError } = await import('../../src/lib/errors.js');
    mockPostRotateKey.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'invalid api key', 401));
    const res = await handler({ httpMethod: 'POST', path: '/dashboard/rotate-key', headers: {} });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns JSON 500 when rotate-key throws unexpected error', async () => {
    mockPostRotateKey.mockRejectedValueOnce(new Error('boom'));
    const res = await handler({ httpMethod: 'POST', path: '/dashboard/rotate-key', headers: {} });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('routes PUT /dashboard/routes to putRoute', async () => {
    mockPutRoute.mockResolvedValueOnce({ statusCode: 200, body: '{}' });
    const res = await handler({ httpMethod: 'PUT', path: '/dashboard/routes', headers: {} });
    expect(res.statusCode).toBe(200);
    expect(mockPutRoute).toHaveBeenCalledOnce();
  });

  it('routes DELETE /dashboard/routes to deleteRoute', async () => {
    mockDeleteRoute.mockResolvedValueOnce({ statusCode: 200, body: '{"ok":true}' });
    const res = await handler({ httpMethod: 'DELETE', path: '/dashboard/routes', headers: {} });
    expect(res.statusCode).toBe(200);
    expect(mockDeleteRoute).toHaveBeenCalledOnce();
  });

  it('routes GET /dashboard/routes to getRoutes', async () => {
    mockGetRoutes.mockResolvedValueOnce({ statusCode: 200, body: '{"routes":[]}' });
    const res = await handler({ httpMethod: 'GET', path: '/dashboard/routes', headers: {} });
    expect(res.statusCode).toBe(200);
    expect(mockGetRoutes).toHaveBeenCalledOnce();
  });

  it('returns JSON error when PUT /dashboard/routes throws AppError', async () => {
    const { AppError } = await import('../../src/lib/errors.js');
    mockPutRoute.mockRejectedValueOnce(new AppError('VALIDATION_ERROR', 'bad input', 400));
    const res = await handler({ httpMethod: 'PUT', path: '/dashboard/routes', headers: {} });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns JSON error when DELETE /dashboard/routes throws AppError', async () => {
    const { AppError } = await import('../../src/lib/errors.js');
    mockDeleteRoute.mockRejectedValueOnce(new AppError('NOT_FOUND', 'Route not found', 404));
    const res = await handler({ httpMethod: 'DELETE', path: '/dashboard/routes', headers: {} });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns JSON error when GET /dashboard/routes throws', async () => {
    mockGetRoutes.mockRejectedValueOnce(new Error('db fail'));
    const res = await handler({ httpMethod: 'GET', path: '/dashboard/routes', headers: {} });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('routes GET /admin to getAdmin', async () => {
    mockGetAdmin.mockResolvedValueOnce({ statusCode: 200, body: '<html>login</html>' });
    const res = await handler({ httpMethod: 'GET', path: '/admin', headers: {} });
    expect(res.statusCode).toBe(200);
    expect(mockGetAdmin).toHaveBeenCalledOnce();
  });

  it('routes POST /admin/login to postAdminLogin', async () => {
    mockPostAdminLogin.mockResolvedValueOnce({
      statusCode: 303,
      headers: { location: '/admin/tenants' },
      body: '',
    });
    const res = await handler({ httpMethod: 'POST', path: '/admin/login', headers: {} });
    expect(res.statusCode).toBe(303);
    expect(mockPostAdminLogin).toHaveBeenCalledOnce();
  });

  it('returns JSON error when POST /admin/login throws AppError', async () => {
    const { AppError } = await import('../../src/lib/errors.js');
    mockPostAdminLogin.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'bad creds', 401));
    const res = await handler({ httpMethod: 'POST', path: '/admin/login', headers: {} });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('routes GET /admin/logout to getAdminLogout', async () => {
    mockGetAdminLogout.mockResolvedValueOnce({
      statusCode: 303,
      headers: { location: '/admin' },
      body: '',
    });
    const res = await handler({ httpMethod: 'GET', path: '/admin/logout', headers: {} });
    expect(res.statusCode).toBe(303);
    expect(mockGetAdminLogout).toHaveBeenCalledOnce();
  });

  it('returns text 500 when GET /admin throws (non-JSON route)', async () => {
    mockGetAdmin.mockRejectedValueOnce(new Error('boom'));
    const res = await handler({ httpMethod: 'GET', path: '/admin', headers: {} });
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('Internal server error');
  });

  it('routes GET /portal/integrate to getPortalIntegrate', async () => {
    const res = await handler({ httpMethod: 'GET', path: '/portal/integrate', headers: {} });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('integrate');
  });

  it('routes GET /admin/tenants/ui to listTenantsUI', async () => {
    mockListTenantsUI.mockResolvedValueOnce({ statusCode: 200, body: '<html>tenants</html>' });
    const res = await handler({ httpMethod: 'GET', path: '/admin/tenants/ui', headers: {} });
    expect(res.statusCode).toBe(200);
    expect(mockListTenantsUI).toHaveBeenCalledOnce();
  });

  it('routes GET /admin/metrics/ui to getAdminMetricsUI', async () => {
    mockGetAdminMetricsUI.mockResolvedValueOnce({ statusCode: 200, body: '<html>metrics</html>' });
    const res = await handler({ httpMethod: 'GET', path: '/admin/metrics/ui', headers: {} });
    expect(res.statusCode).toBe(200);
    expect(mockGetAdminMetricsUI).toHaveBeenCalledOnce();
  });

  it('returns text 500 when GET /admin/metrics/ui throws', async () => {
    mockGetAdminMetricsUI.mockRejectedValueOnce(new Error('metrics fail'));
    const res = await handler({ httpMethod: 'GET', path: '/admin/metrics/ui', headers: {} });
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('Internal server error');
  });
});
