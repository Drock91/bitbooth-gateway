import { UpstreamError } from '../lib/errors.js';

const STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

const DEFAULTS = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxProbes: 1,
};

function loadEnvDefaults() {
  const env = (key, fallback) => {
    const v = process.env[key];
    if (v !== undefined) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return fallback;
  };
  return {
    failureThreshold: env('CB_FAILURE_THRESHOLD', DEFAULTS.failureThreshold),
    resetTimeoutMs: env('CB_RESET_TIMEOUT_MS', DEFAULTS.resetTimeoutMs),
    halfOpenMaxProbes: env('CB_HALF_OPEN_MAX_PROBES', DEFAULTS.halfOpenMaxProbes),
  };
}

export class CircuitBreaker {
  /**
   * @param {string} name - identifier for logging/metrics
   * @param {object} [opts]
   * @param {number} [opts.failureThreshold]
   * @param {number} [opts.resetTimeoutMs]
   * @param {number} [opts.halfOpenMaxProbes]
   * @param {() => number} [opts.now] - clock override for testing
   */
  constructor(name, opts = {}) {
    const envDefaults = loadEnvDefaults();
    this.name = name;
    this.failureThreshold = opts.failureThreshold ?? envDefaults.failureThreshold;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? envDefaults.resetTimeoutMs;
    this.halfOpenMaxProbes = opts.halfOpenMaxProbes ?? envDefaults.halfOpenMaxProbes;
    this._now = opts.now ?? (() => Date.now());
    this._state = STATES.CLOSED;
    this._failureCount = 0;
    this._lastFailureAt = 0;
    this._halfOpenProbes = 0;
  }

  get state() {
    if (this._state === STATES.OPEN) {
      const elapsed = this._now() - this._lastFailureAt;
      if (elapsed >= this.resetTimeoutMs) return STATES.HALF_OPEN;
    }
    return this._state;
  }

  /**
   * Execute fn through the circuit breaker.
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async fire(fn) {
    const current = this.state;

    if (current === STATES.OPEN) {
      throw new UpstreamError(this.name, {
        reason: 'circuit-open',
        failureCount: this._failureCount,
        resetMs: this.resetTimeoutMs - (this._now() - this._lastFailureAt),
      });
    }

    if (current === STATES.HALF_OPEN && this._halfOpenProbes >= this.halfOpenMaxProbes) {
      throw new UpstreamError(this.name, {
        reason: 'circuit-open',
        failureCount: this._failureCount,
        state: 'half_open_saturated',
      });
    }

    if (current === STATES.HALF_OPEN) {
      this._halfOpenProbes++;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  _onSuccess() {
    this._state = STATES.CLOSED;
    this._failureCount = 0;
    this._halfOpenProbes = 0;
  }

  _onFailure() {
    this._failureCount++;
    this._lastFailureAt = this._now();
    if (this._failureCount >= this.failureThreshold) {
      this._state = STATES.OPEN;
    }
    this._halfOpenProbes = 0;
  }

  reset() {
    this._state = STATES.CLOSED;
    this._failureCount = 0;
    this._lastFailureAt = 0;
    this._halfOpenProbes = 0;
  }
}

export { STATES };
