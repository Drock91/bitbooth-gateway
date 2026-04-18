import { describe, it, expect } from 'vitest';
import {
  thresholds,
  scenarios,
  quotePayloads,
  validExecutors,
} from '../../scripts/load-test-config.js';

describe('load-test-config', () => {
  describe('thresholds', () => {
    it('defines thresholds for quote scenario', () => {
      expect(thresholds['http_req_duration{scenario:quote}']).toBeDefined();
      expect(thresholds['http_req_duration{scenario:quote}']).toContain('p(95)<500');
    });

    it('defines thresholds for resource_challenge scenario', () => {
      expect(thresholds['http_req_duration{scenario:resource_challenge}']).toBeDefined();
      expect(thresholds['http_req_duration{scenario:resource_challenge}']).toContain('p(95)<300');
    });

    it('defines global failure rate threshold', () => {
      expect(thresholds['http_req_failed']).toEqual(['rate<0.01']);
    });

    it('defines minimum request rate', () => {
      expect(thresholds['http_reqs']).toEqual(['rate>5']);
    });

    it('all threshold values match k6 format', () => {
      const k6ThresholdPattern = /^(p\(\d+\)|rate|avg|min|max|med|count)[<>=!]+\d+(\.\d+)?$/;
      for (const [, values] of Object.entries(thresholds)) {
        for (const v of values) {
          expect(v).toMatch(k6ThresholdPattern);
        }
      }
    });
  });

  describe('scenarios', () => {
    it('defines quote scenario', () => {
      expect(scenarios.quote).toBeDefined();
      expect(scenarios.quote.exec).toBe('quoteScenario');
    });

    it('defines resource_challenge scenario', () => {
      expect(scenarios.resource_challenge).toBeDefined();
      expect(scenarios.resource_challenge.exec).toBe('resourceChallengeScenario');
    });

    it('all scenarios use valid executors', () => {
      for (const [, scenario] of Object.entries(scenarios)) {
        expect(validExecutors).toContain(scenario.executor);
      }
    });

    it('all scenarios have stages with duration and target', () => {
      for (const [, scenario] of Object.entries(scenarios)) {
        expect(scenario.stages.length).toBeGreaterThan(0);
        for (const stage of scenario.stages) {
          expect(stage).toHaveProperty('duration');
          expect(stage).toHaveProperty('target');
          expect(stage.duration).toMatch(/^\d+[smh]$/);
          expect(typeof stage.target).toBe('number');
          expect(stage.target).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('quote scenario ramps up then down', () => {
      const { stages } = scenarios.quote;
      expect(stages[0].target).toBeGreaterThan(0);
      expect(stages[stages.length - 1].target).toBe(0);
    });

    it('resource_challenge scenario ramps up then down', () => {
      const { stages } = scenarios.resource_challenge;
      expect(stages[0].target).toBeGreaterThan(0);
      expect(stages[stages.length - 1].target).toBe(0);
    });

    it('all scenarios have gracefulRampDown', () => {
      for (const scenario of Object.values(scenarios)) {
        expect(scenario.gracefulRampDown).toBeDefined();
        expect(scenario.gracefulRampDown).toMatch(/^\d+[smh]$/);
      }
    });

    it('all scenarios start from 0 VUs', () => {
      for (const scenario of Object.values(scenarios)) {
        expect(scenario.startVUs).toBe(0);
      }
    });
  });

  describe('quotePayloads', () => {
    it('has at least 3 varied payloads', () => {
      expect(quotePayloads.length).toBeGreaterThanOrEqual(3);
    });

    it('all payloads have required fields', () => {
      for (const p of quotePayloads) {
        expect(p).toHaveProperty('fiatCurrency');
        expect(p).toHaveProperty('fiatAmount');
        expect(p).toHaveProperty('cryptoAsset');
        expect(['USD', 'EUR', 'GBP']).toContain(p.fiatCurrency);
        expect(p.fiatAmount).toBeGreaterThan(0);
        expect(p.fiatAmount).toBeLessThanOrEqual(50000);
        expect(['USDC', 'XRP', 'ETH']).toContain(p.cryptoAsset);
      }
    });

    it('covers multiple fiat currencies', () => {
      const currencies = new Set(quotePayloads.map((p) => p.fiatCurrency));
      expect(currencies.size).toBeGreaterThanOrEqual(2);
    });

    it('covers multiple crypto assets', () => {
      const assets = new Set(quotePayloads.map((p) => p.cryptoAsset));
      expect(assets.size).toBeGreaterThanOrEqual(2);
    });

    it('includes at least one payload with optional exchange field', () => {
      const withExchange = quotePayloads.filter((p) => p.exchange);
      expect(withExchange.length).toBeGreaterThanOrEqual(1);
      expect(typeof withExchange[0].exchange).toBe('string');
      expect(withExchange[0].exchange.length).toBeGreaterThan(0);
    });
  });

  describe('validExecutors', () => {
    it('includes all standard k6 executors', () => {
      expect(validExecutors).toContain('ramping-vus');
      expect(validExecutors).toContain('constant-vus');
      expect(validExecutors).toContain('constant-arrival-rate');
      expect(validExecutors).toContain('ramping-arrival-rate');
    });

    it('has 7 entries', () => {
      expect(validExecutors).toHaveLength(7);
    });
  });
});
