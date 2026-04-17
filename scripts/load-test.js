#!/usr/bin/env k6 run
// k6 load test for /v1/quote and /v1/resource performance baselines.
//
// Usage:
//   k6 run scripts/load-test.js --env BASE_URL=https://api.example.com
//   k6 run scripts/load-test.js --env BASE_URL=https://api.example.com --env API_KEY=sk_test_xxx
//
// Scenarios:
//   quote              — ramps to 10 VUs hitting POST /v1/quote with varied payloads
//   resource_challenge — ramps to 5 VUs hitting POST /v1/resource (expects 402 challenge)

/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { scenarios, thresholds, quotePayloads } from './load-test-config.js';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const API_KEY = __ENV.API_KEY || '';

const quoteLatency = new Trend('quote_latency', true);
const resourceLatency = new Trend('resource_latency', true);
const quoteFailRate = new Rate('quote_fail_rate');
const resourceFailRate = new Rate('resource_fail_rate');

export const options = { scenarios, thresholds };

const jsonHeaders = { 'Content-Type': 'application/json' };

export function quoteScenario() {
  const payload = quotePayloads[Math.floor(Math.random() * quotePayloads.length)];
  const res = http.post(`${BASE_URL}/v1/quote`, JSON.stringify(payload), {
    headers: jsonHeaders,
    tags: { scenario: 'quote' },
  });

  const passed = check(res, {
    'quote: status 200': (r) => r.status === 200,
    'quote: has quote object': (r) => {
      try {
        return JSON.parse(r.body).quote !== undefined;
      } catch {
        return false;
      }
    },
    'quote: latency < 1s': (r) => r.timings.duration < 1000,
  });

  quoteLatency.add(res.timings.duration);
  quoteFailRate.add(!passed);
  sleep(0.5 + Math.random() * 0.5);
}

export function resourceChallengeScenario() {
  const headers = { ...jsonHeaders };
  if (API_KEY) headers['X-API-Key'] = API_KEY;

  const res = http.post(`${BASE_URL}/v1/resource`, null, {
    headers,
    tags: { scenario: 'resource_challenge' },
  });

  // Without a valid X-Payment header we expect a 402 challenge response
  const passed = check(res, {
    'resource: status 401 or 402': (r) => r.status === 401 || r.status === 402,
    'resource: has challenge or error': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.challenge !== undefined || body.error !== undefined;
      } catch {
        return false;
      }
    },
    'resource: latency < 800ms': (r) => r.timings.duration < 800,
  });

  resourceLatency.add(res.timings.duration);
  resourceFailRate.add(!passed);
  sleep(0.5 + Math.random() * 0.5);
}

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    scenarios: {
      quote: {
        p95: data.metrics?.['http_req_duration{scenario:quote}']?.values?.['p(95)'] ?? null,
        p99: data.metrics?.['http_req_duration{scenario:quote}']?.values?.['p(99)'] ?? null,
        reqs: data.metrics?.['http_reqs{scenario:quote}']?.values?.count ?? 0,
      },
      resource_challenge: {
        p95:
          data.metrics?.['http_req_duration{scenario:resource_challenge}']?.values?.['p(95)'] ??
          null,
        p99:
          data.metrics?.['http_req_duration{scenario:resource_challenge}']?.values?.['p(99)'] ??
          null,
        reqs: data.metrics?.['http_reqs{scenario:resource_challenge}']?.values?.count ?? 0,
      },
    },
    thresholdsPassed: !Object.values(data.metrics || {}).some(
      (m) => m.thresholds && Object.values(m.thresholds).some((t) => !t.ok),
    ),
  };

  return {
    stdout: JSON.stringify(summary, null, 2) + '\n',
  };
}
