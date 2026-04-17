// Shared k6 load test configuration — importable by both k6 and Node.js tests.

export const thresholds = {
  'http_req_duration{scenario:quote}': ['p(95)<500', 'p(99)<1000'],
  'http_req_duration{scenario:resource_challenge}': ['p(95)<300', 'p(99)<800'],
  http_req_failed: ['rate<0.01'],
  http_reqs: ['rate>5'],
};

export const scenarios = {
  quote: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 10 },
      { duration: '1m', target: 10 },
      { duration: '30s', target: 0 },
    ],
    gracefulRampDown: '10s',
    exec: 'quoteScenario',
  },
  resource_challenge: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 5 },
      { duration: '1m', target: 5 },
      { duration: '30s', target: 0 },
    ],
    gracefulRampDown: '10s',
    exec: 'resourceChallengeScenario',
  },
};

export const quotePayloads = [
  { fiatCurrency: 'USD', fiatAmount: 100, cryptoAsset: 'USDC' },
  { fiatCurrency: 'USD', fiatAmount: 500, cryptoAsset: 'ETH' },
  { fiatCurrency: 'EUR', fiatAmount: 250, cryptoAsset: 'XRP' },
  { fiatCurrency: 'GBP', fiatAmount: 1000, cryptoAsset: 'USDC' },
  { fiatCurrency: 'USD', fiatAmount: 50, cryptoAsset: 'ETH', exchange: 'coinbase' },
];

export const validExecutors = [
  'ramping-vus',
  'constant-vus',
  'per-vu-iterations',
  'shared-iterations',
  'constant-arrival-rate',
  'ramping-arrival-rate',
  'externally-controlled',
];
