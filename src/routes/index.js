import {
  requirePaidResource,
  requireBulkResource,
  getPayments,
} from '../controllers/payments.controller.js';
import { getHealth, getHealthReady } from '../controllers/health.controller.js';
import { listTenants } from '../controllers/admin.tenants.controller.js';
import { getEarningsHtml, getEarningsJson } from '../controllers/earnings.controller.js';
import { postDemoRelay } from '../controllers/demo-relay.controller.js';

// NOTE: /v1/fetch is intentionally NOT in this routes table. API GW routes
// /v1/fetch directly to lambdas.fetchFn (its own handler). Importing
// fetch.controller here would pull jsdom into the api.js bundle and crash
// the apiFn at cold-start with `ENOENT: /browser/default-stylesheet.css`
// because esbuild can't resolve jsdom's static-asset paths.
//
// /v1/quote is NOT routed: the 5 exchange adapters (moonpay/coinbase/kraken/
// binance/uphold) are stubs that return fake math instead of real exchange
// quotes. Hidden until a real adapter is wired. Adapter code lives in
// src/adapters/* as a future-work scaffold.
const routes = {
  'POST /v1/resource': requirePaidResource,
  'POST /v1/resource/premium': requirePaidResource,
  'POST /v1/resource/bulk': requireBulkResource,
  'GET /v1/payments': getPayments,
  'GET /v1/health': getHealth,
  'GET /v1/health/ready': getHealthReady,
  'GET /admin/tenants': listTenants,
  'GET /admin/earnings': getEarningsHtml,
  'GET /admin/earnings.json': getEarningsJson,
  'POST /v1/demo/relay': postDemoRelay,
};

export function matchRoute(event) {
  return routes[`${event.httpMethod} ${event.path}`];
}
