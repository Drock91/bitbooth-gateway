import {
  getDashboard,
  postSignup,
  postRotateKey,
  putRoute,
  deleteRoute,
  getRoutes,
} from '../controllers/dashboard.controller.js';
import {
  getLanding,
  getFetch,
  getDocs,
  getOpenapiYaml,
} from '../controllers/landing.controller.js';
import { postDemoSignup } from '../controllers/demo.controller.js';
import {
  getPortal,
  postLogin,
  getLogout,
  getPortalDashboard,
  getPortalIntegrate,
  postPortalRotateKey,
} from '../controllers/portal.controller.js';
import {
  getAdmin,
  postAdminLogin,
  getAdminLogout,
  listTenantsUI,
  getAdminMetricsUI,
  getAdminChangePassword,
  postAdminChangePassword,
} from '../controllers/admin.controller.js';
import { withRequestLogging } from '../middleware/request-log.middleware.js';
import { toHttpResponse } from '../middleware/error.middleware.js';
import { logger } from '../lib/logger.js';
import { stagePrefix } from '../lib/stage-prefix.js';
import { withApiVersion } from '../middleware/versioning.middleware.js';
import { withBodySizeLimit } from '../middleware/body-size.middleware.js';
import { withGracefulShutdown } from '../middleware/shutdown.middleware.js';
import { withSecurityHeaders } from '../middleware/security-headers.middleware.js';

const routes = {
  'GET /': getLanding,
  'GET /fetch': getFetch,
  'GET /docs': getDocs,
  'GET /openapi.yaml': getOpenapiYaml,
  'POST /demo/signup': postDemoSignup,
  'GET /dashboard': getDashboard,
  'POST /dashboard/signup': postSignup,
  'POST /dashboard/rotate-key': postRotateKey,
  'PUT /dashboard/routes': putRoute,
  'DELETE /dashboard/routes': deleteRoute,
  'GET /dashboard/routes': getRoutes,
  'GET /portal': getPortal,
  'POST /portal/login': postLogin,
  'GET /portal/logout': getLogout,
  'GET /portal/dashboard': getPortalDashboard,
  'GET /portal/integrate': getPortalIntegrate,
  'POST /portal/rotate-key': postPortalRotateKey,
  'GET /admin': getAdmin,
  'POST /admin/login': postAdminLogin,
  'GET /admin/logout': getAdminLogout,
  'GET /admin/tenants/ui': listTenantsUI,
  'GET /admin/metrics/ui': getAdminMetricsUI,
  'GET /admin/change-password': getAdminChangePassword,
  'POST /admin/change-password': postAdminChangePassword,
};

const jsonRoutes = new Set([
  'POST /demo/signup',
  'POST /dashboard/rotate-key',
  'PUT /dashboard/routes',
  'DELETE /dashboard/routes',
  'GET /dashboard/routes',
  'POST /portal/rotate-key',
  'POST /admin/login',
]);

export const handler = withGracefulShutdown(
  withSecurityHeaders(
    withRequestLogging(
      withBodySizeLimit(
        withApiVersion(async (event) => {
          const key = `${event.httpMethod} ${event.path}`;
          const matched = routes[key];

          if (!matched) {
            return {
              statusCode: 404,
              headers: { 'content-type': 'text/plain' },
              body: 'Not found',
            };
          }

          try {
            return await matched(event);
          } catch (err) {
            logger.error(
              { err: { name: err?.name, message: err?.message, stack: err?.stack }, route: key },
              'dashboard handler error',
            );
            if (jsonRoutes.has(key)) {
              return toHttpResponse(err);
            }
            // For HTML routes: 401s redirect to login, everything else 500.
            // Match on numeric status (not class name — esbuild minifies names).
            if (err?.status === 401 || err?.statusCode === 401 || err?.code === 'UNAUTHORIZED') {
              return {
                statusCode: 303,
                headers: {
                  location: `${stagePrefix(event)}/admin`,
                  'cache-control': 'no-store',
                },
                body: '',
              };
            }
            return {
              statusCode: 500,
              headers: { 'content-type': 'text/plain' },
              body: 'Internal server error',
            };
          }
        }),
      ),
    ),
  ),
);
