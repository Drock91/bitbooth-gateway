import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, STATES } from '../../src/adapters/circuit-breaker.js';
import { UpstreamError } from '../../src/lib/errors.js';

describe('adapters/circuit-breaker', () => {
  let clock;
  let cb;

  beforeEach(() => {
    vi.restoreAllMocks();
    clock = 1000;
    cb = new CircuitBreaker('test', {
      failureThreshold: 3,
      resetTimeoutMs: 5000,
      halfOpenMaxProbes: 1,
      now: () => clock,
    });
  });

  describe('constructor', () => {
    it('starts in CLOSED state', () => {
      expect(cb.state).toBe(STATES.CLOSED);
    });

    it('uses env var defaults when no opts provided', () => {
      process.env.CB_FAILURE_THRESHOLD = '10';
      process.env.CB_RESET_TIMEOUT_MS = '60000';
      process.env.CB_HALF_OPEN_MAX_PROBES = '2';
      const breaker = new CircuitBreaker('env-test');
      expect(breaker.failureThreshold).toBe(10);
      expect(breaker.resetTimeoutMs).toBe(60000);
      expect(breaker.halfOpenMaxProbes).toBe(2);
      delete process.env.CB_FAILURE_THRESHOLD;
      delete process.env.CB_RESET_TIMEOUT_MS;
      delete process.env.CB_HALF_OPEN_MAX_PROBES;
    });

    it('ignores invalid env var values', () => {
      process.env.CB_FAILURE_THRESHOLD = 'not-a-number';
      process.env.CB_RESET_TIMEOUT_MS = '-5';
      process.env.CB_HALF_OPEN_MAX_PROBES = '0';
      const breaker = new CircuitBreaker('env-bad');
      expect(breaker.failureThreshold).toBe(5);
      expect(breaker.resetTimeoutMs).toBe(30000);
      expect(breaker.halfOpenMaxProbes).toBe(1);
      delete process.env.CB_FAILURE_THRESHOLD;
      delete process.env.CB_RESET_TIMEOUT_MS;
      delete process.env.CB_HALF_OPEN_MAX_PROBES;
    });

    it('uses hardcoded defaults when no env vars set', () => {
      const breaker = new CircuitBreaker('default-test');
      expect(breaker.failureThreshold).toBe(5);
      expect(breaker.resetTimeoutMs).toBe(30000);
      expect(breaker.halfOpenMaxProbes).toBe(1);
    });

    it('opts override env vars', () => {
      process.env.CB_FAILURE_THRESHOLD = '10';
      const breaker = new CircuitBreaker('opt-test', { failureThreshold: 2 });
      expect(breaker.failureThreshold).toBe(2);
      delete process.env.CB_FAILURE_THRESHOLD;
    });
  });

  describe('CLOSED state', () => {
    it('passes through successful calls', async () => {
      const result = await cb.fire(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
      expect(cb.state).toBe(STATES.CLOSED);
    });

    it('passes through and propagates errors without opening', async () => {
      const err = new Error('fail');
      await expect(cb.fire(() => Promise.reject(err))).rejects.toThrow('fail');
      expect(cb.state).toBe(STATES.CLOSED);
    });

    it('counts failures but stays closed below threshold', async () => {
      for (let i = 0; i < 2; i++) {
        await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      expect(cb.state).toBe(STATES.CLOSED);
    });

    it('resets failure count on success', async () => {
      await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      await cb.fire(() => Promise.resolve('ok'));
      await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      expect(cb.state).toBe(STATES.CLOSED);
    });
  });

  describe('OPEN state', () => {
    async function tripBreaker() {
      for (let i = 0; i < 3; i++) {
        await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
    }

    it('opens after reaching failure threshold', async () => {
      await tripBreaker();
      expect(cb.state).toBe(STATES.OPEN);
    });

    it('rejects immediately without calling fn', async () => {
      await tripBreaker();
      const fn = vi.fn();
      await expect(cb.fire(fn)).rejects.toThrow(UpstreamError);
      expect(fn).not.toHaveBeenCalled();
    });

    it('includes circuit-open reason in error', async () => {
      await tripBreaker();
      try {
        await cb.fire(() => Promise.resolve());
      } catch (e) {
        expect(e).toBeInstanceOf(UpstreamError);
        expect(e.details.reason).toBe('circuit-open');
        expect(e.details.failureCount).toBe(3);
        expect(typeof e.details.resetMs).toBe('number');
      }
    });

    it('stays open within reset timeout', async () => {
      await tripBreaker();
      clock += 4999;
      expect(cb.state).toBe(STATES.OPEN);
    });
  });

  describe('HALF_OPEN state', () => {
    async function tripAndWait() {
      for (let i = 0; i < 3; i++) {
        await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      clock += 5000;
    }

    it('transitions to HALF_OPEN after reset timeout', async () => {
      await tripAndWait();
      expect(cb.state).toBe(STATES.HALF_OPEN);
    });

    it('allows one probe request', async () => {
      await tripAndWait();
      const result = await cb.fire(() => Promise.resolve('recovered'));
      expect(result).toBe('recovered');
      expect(cb.state).toBe(STATES.CLOSED);
    });

    it('closes on successful probe', async () => {
      await tripAndWait();
      await cb.fire(() => Promise.resolve('ok'));
      expect(cb.state).toBe(STATES.CLOSED);
      const r = await cb.fire(() => Promise.resolve('flowing'));
      expect(r).toBe('flowing');
    });

    it('re-opens on failed probe', async () => {
      await tripAndWait();
      await expect(cb.fire(() => Promise.reject(new Error('still down')))).rejects.toThrow();
      expect(cb.state).toBe(STATES.OPEN);
    });

    it('rejects excess probes beyond halfOpenMaxProbes', async () => {
      await tripAndWait();
      cb._halfOpenProbes = 1;
      const fn = vi.fn();
      await expect(cb.fire(fn)).rejects.toThrow(UpstreamError);
      expect(fn).not.toHaveBeenCalled();
    });

    it('includes half_open_saturated state in excess probe error', async () => {
      await tripAndWait();
      cb._halfOpenProbes = 1;
      try {
        await cb.fire(() => Promise.resolve());
      } catch (e) {
        expect(e.details.state).toBe('half_open_saturated');
      }
    });

    it('allows multiple probes when halfOpenMaxProbes > 1', async () => {
      const cb2 = new CircuitBreaker('multi', {
        failureThreshold: 2,
        resetTimeoutMs: 1000,
        halfOpenMaxProbes: 3,
        now: () => clock,
      });
      await expect(cb2.fire(() => Promise.reject(new Error('a')))).rejects.toThrow();
      await expect(cb2.fire(() => Promise.reject(new Error('b')))).rejects.toThrow();
      clock += 1000;
      expect(cb2.state).toBe(STATES.HALF_OPEN);
      await cb2.fire(() => Promise.resolve('ok'));
      expect(cb2.state).toBe(STATES.CLOSED);
    });
  });

  describe('reset()', () => {
    it('returns to CLOSED from OPEN', async () => {
      for (let i = 0; i < 3; i++) {
        await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      expect(cb.state).toBe(STATES.OPEN);
      cb.reset();
      expect(cb.state).toBe(STATES.CLOSED);
    });

    it('clears failure count', async () => {
      await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      cb.reset();
      await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      expect(cb.state).toBe(STATES.CLOSED);
    });

    it('allows calls again after reset from OPEN', async () => {
      for (let i = 0; i < 3; i++) {
        await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      cb.reset();
      const result = await cb.fire(() => Promise.resolve('back'));
      expect(result).toBe('back');
    });
  });

  describe('state transitions lifecycle', () => {
    it('CLOSED → OPEN → HALF_OPEN → CLOSED (recovery)', async () => {
      expect(cb.state).toBe(STATES.CLOSED);
      for (let i = 0; i < 3; i++) {
        await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      expect(cb.state).toBe(STATES.OPEN);
      clock += 5000;
      expect(cb.state).toBe(STATES.HALF_OPEN);
      await cb.fire(() => Promise.resolve('healed'));
      expect(cb.state).toBe(STATES.CLOSED);
    });

    it('CLOSED → OPEN → HALF_OPEN → OPEN (probe fails)', async () => {
      for (let i = 0; i < 3; i++) {
        await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      expect(cb.state).toBe(STATES.OPEN);
      clock += 5000;
      expect(cb.state).toBe(STATES.HALF_OPEN);
      await expect(cb.fire(() => Promise.reject(new Error('nope')))).rejects.toThrow();
      expect(cb.state).toBe(STATES.OPEN);
    });

    it('failure counter resets after full recovery cycle', async () => {
      for (let i = 0; i < 3; i++) {
        await expect(cb.fire(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      clock += 5000;
      await cb.fire(() => Promise.resolve('ok'));
      // Now back to CLOSED with 0 failures — need 3 more to trip
      await expect(cb.fire(() => Promise.reject(new Error('a')))).rejects.toThrow();
      await expect(cb.fire(() => Promise.reject(new Error('b')))).rejects.toThrow();
      expect(cb.state).toBe(STATES.CLOSED);
    });
  });

  describe('STATES export', () => {
    it('exports all three state names', () => {
      expect(STATES.CLOSED).toBe('CLOSED');
      expect(STATES.OPEN).toBe('OPEN');
      expect(STATES.HALF_OPEN).toBe('HALF_OPEN');
    });
  });
});
