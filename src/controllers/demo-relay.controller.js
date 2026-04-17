import { runDemoRelay } from '../services/demo-relay.service.js';
import { parseBody } from '../middleware/validate.middleware.js';
import { DemoRelayRequest } from '../validators/demo-relay.schema.js';
import { jsonResponse } from '../middleware/error.middleware.js';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '3600',
};

/**
 * POST /v1/demo/relay — public, unauth'd endpoint that fires a real on-chain
 * transfer from the demo agent wallet to a fresh ephemeral receiver. Used by
 * the bitbooth.html "Race Mode" landing-page demo to show a truly live ETH
 * settlement next to XRPL/Solana/Stellar.
 *
 * Per-IP rate limit (1 / minute) prevents drainage of the demo wallet.
 */
export async function postDemoRelay(event) {
  // Empty-body validation — the endpoint accepts no inputs to prevent abuse.
  parseBody(DemoRelayRequest, event.body || '{}');

  const sourceIp = event.requestContext?.identity?.sourceIp || 'unknown';
  const result = await runDemoRelay({ sourceIp });

  const resp = jsonResponse(200, result);
  resp.headers = { ...resp.headers, ...CORS_HEADERS };
  return resp;
}
