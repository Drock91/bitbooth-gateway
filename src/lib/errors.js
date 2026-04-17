export class AppError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(details) {
    super('VALIDATION_ERROR', 'Invalid request', 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(reason = 'Unauthorized') {
    super('UNAUTHORIZED', reason, 401);
  }
}

export class PaymentRequiredError extends AppError {
  constructor(challenge) {
    super('PAYMENT_REQUIRED', 'Payment required', 402, challenge);
    this.challenge = challenge;
  }
}

export class NotFoundError extends AppError {
  constructor(resource) {
    super('NOT_FOUND', `${resource} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(reason) {
    super('CONFLICT', reason, 409);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(retryAfterSeconds, limit) {
    super('RATE_LIMITED', 'Too many requests', 429, { retryAfter: retryAfterSeconds });
    this.retryAfter = retryAfterSeconds;
    this.limit = limit ?? 0;
  }
}

export class FraudDetectedError extends AppError {
  constructor(details) {
    super('FRAUD_DETECTED', 'Fraudulent activity detected', 403, details);
  }
}

export class UpstreamError extends AppError {
  constructor(upstream, details) {
    super('UPSTREAM_ERROR', `Upstream ${upstream} failed`, 502, details);
  }
}

export function isAppError(e) {
  return e instanceof AppError;
}
