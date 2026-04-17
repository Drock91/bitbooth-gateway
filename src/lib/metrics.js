import { logger } from './logger.js';

const NAMESPACE = 'x402';

/**
 * Emit a CloudWatch metric via Embedded Metric Format (EMF).
 * In Lambda, structured logs matching the EMF schema are automatically
 * ingested as CloudWatch Metrics with zero API overhead.
 *
 * @param {string} name - Metric name (e.g. 'payment.verified')
 * @param {number} value - Metric value (default 1)
 * @param {string} unit - CloudWatch unit (default 'Count')
 * @param {Record<string, string>} dimensions - Key-value dimension pairs
 */
export function emitMetric(name, { value = 1, unit = 'Count', dimensions = {} } = {}) {
  const dimKeys = Object.keys(dimensions);

  const emf = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: NAMESPACE,
          Dimensions: dimKeys.length > 0 ? [dimKeys] : [[]],
          Metrics: [{ Name: name, Unit: unit }],
        },
      ],
    },
    ...dimensions,
    [name]: value,
  };

  logger.info(emf, `metric:${name}`);
}

export function paymentVerified({ accountId, route }) {
  emitMetric('payment.verified', { dimensions: { accountId, route } });
}

export function paymentFailed({ accountId, route, reason }) {
  emitMetric('payment.failed', { dimensions: { accountId, route, reason } });
}

export function tenantSignup({ accountId, plan }) {
  emitMetric('tenant.signup', { dimensions: { accountId, plan } });
}

export function routeCreated({ accountId, path }) {
  emitMetric('route.created', { dimensions: { accountId, path } });
}

export function routeDeleted({ accountId, path }) {
  emitMetric('route.deleted', { dimensions: { accountId, path } });
}

export function apiKeyRotated({ accountId }) {
  emitMetric('apiKey.rotated', { dimensions: { accountId } });
}

export function planChanged({ accountId, plan, action }) {
  emitMetric('plan.changed', { dimensions: { accountId, plan, action } });
}

export function demoSignup({ accountId, emailDomain }) {
  emitMetric('demo.signup', { dimensions: { accountId, emailDomain } });
}
