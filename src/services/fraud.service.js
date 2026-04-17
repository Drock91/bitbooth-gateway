import { fraudRepo } from '../repositories/fraud.repo.js';
import { FraudDetectedError } from '../lib/errors.js';

const DEFAULT_RULES = {
  maxPaymentsPerMinute: Number(process.env.FRAUD_MAX_PAYMENTS_PER_MINUTE ?? 5),
  maxPaymentsPerHour: Number(process.env.FRAUD_MAX_PAYMENTS_PER_HOUR ?? 60),
  maxNonceFailuresPerMinute: Number(process.env.FRAUD_MAX_NONCE_FAILURES_PER_MINUTE ?? 3),
  minAmountWei: process.env.FRAUD_MIN_AMOUNT_WEI ?? '1000',
  maxAmountWei: process.env.FRAUD_MAX_AMOUNT_WEI ?? '100000000000000000000',
};

/**
 * Build a minute-granularity window key.
 * @param {string} prefix
 * @returns {string} e.g. "velocity:2026-04-05T12:05"
 */
function minuteWindowKey(prefix) {
  return `${prefix}:${new Date().toISOString().slice(0, 16)}`;
}

/**
 * Build an hour-granularity window key.
 * @param {string} prefix
 * @returns {string} e.g. "velocity-h:2026-04-05T12"
 */
function hourWindowKey(prefix) {
  return `${prefix}:${new Date().toISOString().slice(0, 13)}`;
}

function mergeRules(routeFraudRules) {
  return { ...DEFAULT_RULES, ...routeFraudRules };
}

export const fraudService = {
  /**
   * Run all fraud checks before recording a payment.
   * Throws FraudDetectedError if any rule trips.
   *
   * @param {object} params
   * @param {string} params.accountId
   * @param {string} params.amountWei
   * @param {object} [params.fraudRules] – per-route overrides from routes table
   */
  async checkPrePayment({ accountId, amountWei, fraudRules }) {
    const rules = mergeRules(fraudRules);
    await Promise.all([this.checkVelocity(accountId, rules), this.checkAmount(amountWei, rules)]);
  },

  /**
   * Velocity check: too many payments in a rolling window.
   */
  async checkVelocity(accountId, rules) {
    const [minuteTally, hourTally] = await Promise.all([
      fraudRepo.incrementTally(accountId, minuteWindowKey('velocity')),
      fraudRepo.incrementTally(accountId, hourWindowKey('velocity-h')),
    ]);

    if (minuteTally.eventCount > rules.maxPaymentsPerMinute) {
      await fraudRepo.recordEvent({
        accountId,
        eventType: 'high_velocity',
        severity: 'high',
        details: {
          window: '1m',
          count: minuteTally.eventCount,
          limit: rules.maxPaymentsPerMinute,
        },
      });
      throw new FraudDetectedError({
        rule: 'high_velocity',
        window: '1m',
        count: minuteTally.eventCount,
        limit: rules.maxPaymentsPerMinute,
      });
    }

    if (hourTally.eventCount > rules.maxPaymentsPerHour) {
      await fraudRepo.recordEvent({
        accountId,
        eventType: 'high_velocity',
        severity: 'medium',
        details: {
          window: '1h',
          count: hourTally.eventCount,
          limit: rules.maxPaymentsPerHour,
        },
      });
      throw new FraudDetectedError({
        rule: 'high_velocity',
        window: '1h',
        count: hourTally.eventCount,
        limit: rules.maxPaymentsPerHour,
      });
    }
  },

  /**
   * Amount check: payment outside acceptable bounds.
   */
  async checkAmount(amountWei, rules) {
    const amount = BigInt(amountWei);
    const min = BigInt(rules.minAmountWei);
    const max = BigInt(rules.maxAmountWei);

    if (amount < min || amount > max) {
      throw new FraudDetectedError({
        rule: 'abnormal_amount',
        amountWei,
        minWei: rules.minAmountWei,
        maxWei: rules.maxAmountWei,
      });
    }
  },

  /**
   * Track repeated nonce failures (called when nonce reuse is detected).
   * If failures exceed threshold, flag the account.
   */
  async trackNonceFailure(accountId, fraudRules) {
    const rules = mergeRules(fraudRules);
    const tally = await fraudRepo.incrementTally(accountId, minuteWindowKey('nonce-fail'));

    if (tally.eventCount > rules.maxNonceFailuresPerMinute) {
      await fraudRepo.recordEvent({
        accountId,
        eventType: 'repeated_nonce_failure',
        severity: 'high',
        details: {
          window: '1m',
          count: tally.eventCount,
          limit: rules.maxNonceFailuresPerMinute,
        },
      });
      throw new FraudDetectedError({
        rule: 'repeated_nonce_failure',
        window: '1m',
        count: tally.eventCount,
        limit: rules.maxNonceFailuresPerMinute,
      });
    }
  },
};
