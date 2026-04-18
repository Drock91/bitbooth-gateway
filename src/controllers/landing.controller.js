import { LANDING_HTML } from '../static/landing.html.js';
import { FETCH_HTML } from '../static/fetch.html.js';
import { SWAGGER_HTML } from '../static/swagger-ui.html.js';
import { AGENT_DOCS_HTML } from '../static/agent-docs.html.js';
import { loadOpenapiYaml } from '../lib/load-openapi.js';

const LANDING_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join('; ');

const DOCS_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' https://unpkg.com",
  "script-src 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: https://unpkg.com",
  "font-src 'self' https://unpkg.com",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join('; ');

function htmlResponse(status, body, csp) {
  return {
    statusCode: status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'content-security-policy': csp,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
    body,
  };
}

export async function getLanding() {
  return htmlResponse(200, LANDING_HTML, LANDING_CSP);
}

export async function getFetch() {
  return htmlResponse(200, FETCH_HTML, LANDING_CSP);
}

export async function getDocs() {
  return htmlResponse(200, SWAGGER_HTML, DOCS_CSP);
}

export async function getAgentDocs() {
  return htmlResponse(200, AGENT_DOCS_HTML, LANDING_CSP);
}

export async function getOpenapiYaml() {
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/yaml; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
    },
    body: loadOpenapiYaml(),
  };
}
