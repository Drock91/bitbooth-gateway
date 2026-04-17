import pino from 'pino';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-payment"]',
  'req.headers["x-api-key"]',
  'apiKey',
  'secret',
  'secretKey',
  'privateKey',
  'seed',
  'mnemonic',
  'signature',
  '*.apiKey',
  '*.secretKey',
  '*.privateKey',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  base: { service: 'x402', stage: process.env.STAGE },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function withCorrelation(correlationId) {
  return logger.child({ correlationId });
}

const FLUSH_TIMEOUT_MS = 2000;

export function flushLogger(timeoutMs = FLUSH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    logger.flush((err) => {
      clearTimeout(timer);
      resolve(err);
    });
  });
}
