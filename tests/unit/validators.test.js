import { describe, it, expect } from 'vitest';
import {
  HexAddress,
  HexTxHash,
  WeiAmount,
  CreateChallengeRequest,
  PaymentHeader,
  IdempotencyKey as PaymentIdempotencyKey,
  PaymentsHistoryQuery,
} from '../../src/validators/payment.schema.js';
import {
  AccountId,
  ApiKeyHash,
  Plan,
  TenantStatus,
  CreateTenantInput,
  TenantItem,
} from '../../src/validators/tenant.schema.js';
import { AdminTenantsUIQuery } from '../../src/validators/admin.schema.js';
import {
  RoutePath,
  Asset,
  FraudRules,
  CreateRouteInput,
  RouteItem,
} from '../../src/validators/route.schema.js';
import {
  FraudEventType,
  FraudEvent,
  FraudTally,
  VelocityWindow,
  AmountThresholds,
} from '../../src/validators/fraud.schema.js';
import { SupportedExchange, QuoteRequest } from '../../src/validators/exchange.schema.js';
import { IdempotencyKey, IdempotencyRecord } from '../../src/validators/idempotency.schema.js';
import { RateLimitBucket } from '../../src/validators/rate-limit.schema.js';
import {
  StripePriceToPlans,
  StripeSubscriptionEvent,
  HANDLED_EVENTS,
} from '../../src/validators/stripe.schema.js';
import { HealthCheckResult, HealthReadyResponse } from '../../src/validators/health.schema.js';

// ─── payment.schema ──────────────────────────────────────────────

describe('payment.schema', () => {
  describe('HexAddress', () => {
    it('accepts valid lowercase address', () => {
      expect(HexAddress.parse('0x' + 'a'.repeat(40))).toBe('0x' + 'a'.repeat(40));
    });

    it('accepts valid uppercase address', () => {
      expect(HexAddress.parse('0x' + 'A'.repeat(40))).toBe('0x' + 'A'.repeat(40));
    });

    it('accepts mixed-case address', () => {
      expect(HexAddress.parse('0x' + 'aB'.repeat(20))).toBe('0x' + 'aB'.repeat(20));
    });

    it('rejects address without 0x prefix', () => {
      expect(() => HexAddress.parse('a'.repeat(40))).toThrow();
    });

    it('rejects address too short', () => {
      expect(() => HexAddress.parse('0x' + 'a'.repeat(39))).toThrow();
    });

    it('rejects address too long', () => {
      expect(() => HexAddress.parse('0x' + 'a'.repeat(41))).toThrow();
    });

    it('rejects non-hex characters', () => {
      expect(() => HexAddress.parse('0x' + 'g'.repeat(40))).toThrow();
    });

    it('rejects empty string', () => {
      expect(() => HexAddress.parse('')).toThrow();
    });
  });

  describe('HexTxHash', () => {
    it('accepts valid 64-char hex hash', () => {
      expect(HexTxHash.parse('0x' + 'f'.repeat(64))).toBe('0x' + 'f'.repeat(64));
    });

    it('rejects hash without 0x prefix', () => {
      expect(() => HexTxHash.parse('f'.repeat(64))).toThrow();
    });

    it('rejects hash too short', () => {
      expect(() => HexTxHash.parse('0x' + 'f'.repeat(63))).toThrow();
    });

    it('rejects hash too long', () => {
      expect(() => HexTxHash.parse('0x' + 'f'.repeat(65))).toThrow();
    });
  });

  describe('WeiAmount', () => {
    it('accepts "0"', () => {
      expect(WeiAmount.parse('0')).toBe('0');
    });

    it('accepts large integer string', () => {
      expect(WeiAmount.parse('99999999999999999999')).toBe('99999999999999999999');
    });

    it('rejects negative', () => {
      expect(() => WeiAmount.parse('-1')).toThrow();
    });

    it('rejects decimal', () => {
      expect(() => WeiAmount.parse('1.5')).toThrow();
    });

    it('rejects empty string', () => {
      expect(() => WeiAmount.parse('')).toThrow();
    });

    it('rejects number type', () => {
      expect(() => WeiAmount.parse(100)).toThrow();
    });
  });

  describe('CreateChallengeRequest', () => {
    const valid = { resource: '/api/data', amountWei: '1000', assetSymbol: 'USDC' };

    it('accepts valid input', () => {
      expect(CreateChallengeRequest.parse(valid)).toEqual(valid);
    });

    it('rejects empty resource', () => {
      expect(() => CreateChallengeRequest.parse({ ...valid, resource: '' })).toThrow();
    });

    it('rejects resource over 256 chars', () => {
      expect(() => CreateChallengeRequest.parse({ ...valid, resource: 'x'.repeat(257) })).toThrow();
    });

    it('rejects empty assetSymbol', () => {
      expect(() => CreateChallengeRequest.parse({ ...valid, assetSymbol: '' })).toThrow();
    });

    it('rejects assetSymbol over 16 chars', () => {
      expect(() =>
        CreateChallengeRequest.parse({ ...valid, assetSymbol: 'A'.repeat(17) }),
      ).toThrow();
    });

    it('rejects missing fields', () => {
      expect(() => CreateChallengeRequest.parse({})).toThrow();
    });
  });

  describe('PaymentHeader', () => {
    const valid = {
      nonce: 'a'.repeat(32),
      txHash: '0x' + 'b'.repeat(64),
      signature: 'sig',
    };

    it('accepts valid header', () => {
      expect(PaymentHeader.parse(valid).nonce).toBe(valid.nonce);
    });

    it('accepts nonce at min length (16)', () => {
      expect(PaymentHeader.parse({ ...valid, nonce: 'n'.repeat(16) }).nonce).toBe('n'.repeat(16));
    });

    it('accepts nonce at max length (64)', () => {
      expect(PaymentHeader.parse({ ...valid, nonce: 'n'.repeat(64) }).nonce).toBe('n'.repeat(64));
    });

    it('rejects nonce too short', () => {
      expect(() => PaymentHeader.parse({ ...valid, nonce: 'n'.repeat(15) })).toThrow();
    });

    it('rejects nonce too long', () => {
      expect(() => PaymentHeader.parse({ ...valid, nonce: 'n'.repeat(65) })).toThrow();
    });

    it('rejects empty signature', () => {
      expect(() => PaymentHeader.parse({ ...valid, signature: '' })).toThrow();
    });

    it('rejects invalid txHash', () => {
      expect(() => PaymentHeader.parse({ ...valid, txHash: 'not-a-hash' })).toThrow();
    });
  });

  describe('IdempotencyKey (payment)', () => {
    it('accepts valid UUID', () => {
      expect(PaymentIdempotencyKey.parse('550e8400-e29b-41d4-a716-446655440000')).toBeTruthy();
    });

    it('rejects non-UUID string', () => {
      expect(() => PaymentIdempotencyKey.parse('not-a-uuid')).toThrow();
    });
  });

  describe('PaymentsHistoryQuery', () => {
    it('accepts empty object with defaults', () => {
      const result = PaymentsHistoryQuery.parse({});
      expect(result.limit).toBe(20);
      expect(result.cursor).toBeUndefined();
    });

    it('accepts valid limit as string (coerced)', () => {
      const result = PaymentsHistoryQuery.parse({ limit: '50' });
      expect(result.limit).toBe(50);
    });

    it('accepts valid limit as number', () => {
      const result = PaymentsHistoryQuery.parse({ limit: 10 });
      expect(result.limit).toBe(10);
    });

    it('accepts cursor string', () => {
      const result = PaymentsHistoryQuery.parse({ cursor: 'abc123' });
      expect(result.cursor).toBe('abc123');
    });

    it('rejects limit = 0', () => {
      expect(() => PaymentsHistoryQuery.parse({ limit: '0' })).toThrow();
    });

    it('rejects limit > 100', () => {
      expect(() => PaymentsHistoryQuery.parse({ limit: '101' })).toThrow();
    });

    it('rejects negative limit', () => {
      expect(() => PaymentsHistoryQuery.parse({ limit: '-1' })).toThrow();
    });

    it('rejects non-integer limit', () => {
      expect(() => PaymentsHistoryQuery.parse({ limit: '1.5' })).toThrow();
    });

    it('rejects empty cursor string', () => {
      expect(() => PaymentsHistoryQuery.parse({ cursor: '' })).toThrow();
    });

    it('accepts boundary limit = 1', () => {
      const result = PaymentsHistoryQuery.parse({ limit: '1' });
      expect(result.limit).toBe(1);
    });

    it('accepts boundary limit = 100', () => {
      const result = PaymentsHistoryQuery.parse({ limit: '100' });
      expect(result.limit).toBe(100);
    });
  });
});

// ─── tenant.schema ───────────────────────────────────────────────

describe('tenant.schema', () => {
  describe('AccountId', () => {
    it('accepts valid UUID', () => {
      expect(AccountId.parse('550e8400-e29b-41d4-a716-446655440000')).toBeTruthy();
    });

    it('rejects non-UUID', () => {
      expect(() => AccountId.parse('abc123')).toThrow();
    });
  });

  describe('ApiKeyHash', () => {
    it('accepts 64-char lowercase hex', () => {
      expect(ApiKeyHash.parse('a'.repeat(64))).toBe('a'.repeat(64));
    });

    it('rejects uppercase hex', () => {
      expect(() => ApiKeyHash.parse('A'.repeat(64))).toThrow();
    });

    it('rejects 63-char hex', () => {
      expect(() => ApiKeyHash.parse('a'.repeat(63))).toThrow();
    });

    it('rejects 65-char hex', () => {
      expect(() => ApiKeyHash.parse('a'.repeat(65))).toThrow();
    });
  });

  describe('Plan', () => {
    it.each(['free', 'starter', 'growth', 'scale'])('accepts "%s"', (plan) => {
      expect(Plan.parse(plan)).toBe(plan);
    });

    it('rejects unknown plan', () => {
      expect(() => Plan.parse('enterprise')).toThrow();
    });
  });

  describe('TenantStatus', () => {
    it.each(['active', 'suspended'])('accepts "%s"', (status) => {
      expect(TenantStatus.parse(status)).toBe(status);
    });

    it('defaults to active when undefined', () => {
      expect(TenantStatus.parse(undefined)).toBe('active');
    });

    it('rejects unknown status', () => {
      expect(() => TenantStatus.parse('banned')).toThrow();
    });

    it('rejects empty string', () => {
      expect(() => TenantStatus.parse('')).toThrow();
    });
  });

  describe('AdminTenantsUIQuery', () => {
    it('defaults limit to 50', () => {
      expect(AdminTenantsUIQuery.parse({}).limit).toBe(50);
    });

    it('accepts valid limit', () => {
      expect(AdminTenantsUIQuery.parse({ limit: '25' }).limit).toBe(25);
    });

    it('coerces string limit to number', () => {
      expect(AdminTenantsUIQuery.parse({ limit: '10' }).limit).toBe(10);
    });

    it('rejects limit below 1', () => {
      expect(() => AdminTenantsUIQuery.parse({ limit: '0' })).toThrow();
    });

    it('rejects limit above 100', () => {
      expect(() => AdminTenantsUIQuery.parse({ limit: '101' })).toThrow();
    });

    it('accepts optional cursor', () => {
      expect(AdminTenantsUIQuery.parse({ cursor: 'abc' }).cursor).toBe('abc');
    });

    it('rejects empty cursor string', () => {
      expect(() => AdminTenantsUIQuery.parse({ cursor: '' })).toThrow();
    });

    it('accepts optional plan filter', () => {
      expect(AdminTenantsUIQuery.parse({ plan: 'growth' }).plan).toBe('growth');
    });

    it('rejects invalid plan filter', () => {
      expect(() => AdminTenantsUIQuery.parse({ plan: 'bad' })).toThrow();
    });

    it('accepts all fields together', () => {
      const result = AdminTenantsUIQuery.parse({ limit: '30', cursor: 'xyz', plan: 'scale' });
      expect(result).toEqual({ limit: 30, cursor: 'xyz', plan: 'scale' });
    });
  });

  describe('CreateTenantInput', () => {
    const valid = {
      accountId: '550e8400-e29b-41d4-a716-446655440000',
      apiKeyHash: 'a'.repeat(64),
    };

    it('defaults plan to free', () => {
      expect(CreateTenantInput.parse(valid).plan).toBe('free');
    });

    it('accepts explicit plan', () => {
      expect(CreateTenantInput.parse({ ...valid, plan: 'growth' }).plan).toBe('growth');
    });

    it('accepts optional stripeCustomerId', () => {
      const result = CreateTenantInput.parse({ ...valid, stripeCustomerId: 'cus_123' });
      expect(result.stripeCustomerId).toBe('cus_123');
    });

    it('allows omitting stripeCustomerId', () => {
      const result = CreateTenantInput.parse(valid);
      expect(result.stripeCustomerId).toBeUndefined();
    });

    it('rejects missing accountId', () => {
      expect(() => CreateTenantInput.parse({ apiKeyHash: 'a'.repeat(64) })).toThrow();
    });

    it('rejects empty stripeCustomerId', () => {
      expect(() => CreateTenantInput.parse({ ...valid, stripeCustomerId: '' })).toThrow();
    });
  });

  describe('TenantItem', () => {
    const valid = {
      accountId: '550e8400-e29b-41d4-a716-446655440000',
      apiKeyHash: 'a'.repeat(64),
      plan: 'starter',
      createdAt: '2026-04-06T00:00:00Z',
    };

    it('accepts valid item', () => {
      expect(TenantItem.parse(valid).plan).toBe('starter');
    });

    it('accepts optional stripeCustomerId', () => {
      expect(TenantItem.parse({ ...valid, stripeCustomerId: 'cus_x' }).stripeCustomerId).toBe(
        'cus_x',
      );
    });

    it('rejects invalid datetime', () => {
      expect(() => TenantItem.parse({ ...valid, createdAt: 'not-a-date' })).toThrow();
    });

    it('rejects missing plan', () => {
      const { plan: _plan, ...rest } = valid;
      expect(() => TenantItem.parse(rest)).toThrow();
    });

    it('defaults status to active when omitted', () => {
      expect(TenantItem.parse(valid).status).toBe('active');
    });

    it('accepts explicit status', () => {
      expect(TenantItem.parse({ ...valid, status: 'suspended' }).status).toBe('suspended');
    });

    it('rejects invalid status', () => {
      expect(() => TenantItem.parse({ ...valid, status: 'banned' })).toThrow();
    });
  });
});

// ─── route.schema ────────────────────────────────────────────────

describe('route.schema', () => {
  describe('RoutePath', () => {
    it('accepts valid path', () => {
      expect(RoutePath.parse('/api/v1/data')).toBe('/api/v1/data');
    });

    it('rejects path without leading slash', () => {
      expect(() => RoutePath.parse('api/data')).toThrow();
    });

    it('rejects empty string', () => {
      expect(() => RoutePath.parse('')).toThrow();
    });

    it('rejects path over 512 chars', () => {
      expect(() => RoutePath.parse('/' + 'x'.repeat(512))).toThrow();
    });

    it('accepts path at max 512 chars', () => {
      expect(RoutePath.parse('/' + 'x'.repeat(511))).toBeTruthy();
    });
  });

  describe('Asset', () => {
    it('accepts USDC', () => {
      expect(Asset.parse('USDC')).toBe('USDC');
    });

    it('rejects other assets', () => {
      expect(() => Asset.parse('ETH')).toThrow();
    });
  });

  describe('FraudRules', () => {
    it('accepts undefined (optional)', () => {
      expect(FraudRules.parse(undefined)).toBeUndefined();
    });

    it('accepts empty object', () => {
      expect(FraudRules.parse({})).toEqual({});
    });

    it('accepts maxAmountWei only', () => {
      expect(FraudRules.parse({ maxAmountWei: '5000' })).toEqual({ maxAmountWei: '5000' });
    });

    it('accepts velocityPerMinute only', () => {
      expect(FraudRules.parse({ velocityPerMinute: 10 })).toEqual({ velocityPerMinute: 10 });
    });

    it('rejects non-integer velocityPerMinute', () => {
      expect(() => FraudRules.parse({ velocityPerMinute: 1.5 })).toThrow();
    });

    it('rejects zero velocityPerMinute', () => {
      expect(() => FraudRules.parse({ velocityPerMinute: 0 })).toThrow();
    });

    it('rejects negative velocityPerMinute', () => {
      expect(() => FraudRules.parse({ velocityPerMinute: -1 })).toThrow();
    });

    it('rejects non-digit maxAmountWei', () => {
      expect(() => FraudRules.parse({ maxAmountWei: '-100' })).toThrow();
    });
  });

  describe('CreateRouteInput', () => {
    const valid = {
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
      path: '/api/data',
      priceWei: '1000',
    };

    it('defaults asset to USDC', () => {
      expect(CreateRouteInput.parse(valid).asset).toBe('USDC');
    });

    it('accepts explicit asset', () => {
      expect(CreateRouteInput.parse({ ...valid, asset: 'USDC' }).asset).toBe('USDC');
    });

    it('accepts fraudRules', () => {
      const result = CreateRouteInput.parse({ ...valid, fraudRules: { velocityPerMinute: 5 } });
      expect(result.fraudRules.velocityPerMinute).toBe(5);
    });

    it('rejects missing tenantId', () => {
      const { tenantId: _tenantId, ...rest } = valid;
      expect(() => CreateRouteInput.parse(rest)).toThrow();
    });

    it('rejects non-digit priceWei', () => {
      expect(() => CreateRouteInput.parse({ ...valid, priceWei: 'abc' })).toThrow();
    });
  });

  describe('RouteItem', () => {
    const valid = {
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
      path: '/api/data',
      priceWei: '1000',
      asset: 'USDC',
      createdAt: '2026-04-06T00:00:00Z',
      updatedAt: '2026-04-06T00:00:00Z',
    };

    it('accepts valid item', () => {
      expect(RouteItem.parse(valid).path).toBe('/api/data');
    });

    it('rejects missing updatedAt', () => {
      const { updatedAt: _updatedAt, ...rest } = valid;
      expect(() => RouteItem.parse(rest)).toThrow();
    });

    it('rejects invalid createdAt format', () => {
      expect(() => RouteItem.parse({ ...valid, createdAt: '2026-13-01' })).toThrow();
    });
  });
});

// ─── fraud.schema ────────────────────────────────────────────────

describe('fraud.schema', () => {
  describe('FraudEventType', () => {
    it.each([
      'high_velocity',
      'repeated_nonce_failure',
      'abnormal_amount',
      'admin.login',
      'admin.logout',
      'admin.listTenants',
    ])('accepts "%s"', (t) => {
      expect(FraudEventType.parse(t)).toBe(t);
    });

    it('rejects unknown type', () => {
      expect(() => FraudEventType.parse('ddos')).toThrow();
    });
  });

  describe('FraudEvent', () => {
    const valid = {
      accountId: 'acct-1',
      timestamp: '2026-04-06T00:00:00Z',
      eventType: 'high_velocity',
      severity: 'high',
      details: { ip: '1.2.3.4' },
    };

    it('accepts valid event', () => {
      expect(FraudEvent.parse(valid).eventType).toBe('high_velocity');
    });

    it('accepts optional ttl', () => {
      expect(FraudEvent.parse({ ...valid, ttl: 3600 }).ttl).toBe(3600);
    });

    it('rejects ttl of 0', () => {
      expect(() => FraudEvent.parse({ ...valid, ttl: 0 })).toThrow();
    });

    it('rejects negative ttl', () => {
      expect(() => FraudEvent.parse({ ...valid, ttl: -1 })).toThrow();
    });

    it('rejects invalid severity', () => {
      expect(() => FraudEvent.parse({ ...valid, severity: 'critical' })).toThrow();
    });

    it.each(['info', 'low', 'medium', 'high'])('accepts severity "%s"', (s) => {
      expect(FraudEvent.parse({ ...valid, severity: s }).severity).toBe(s);
    });

    it('rejects empty accountId', () => {
      expect(() => FraudEvent.parse({ ...valid, accountId: '' })).toThrow();
    });

    it('accepts empty details object', () => {
      expect(FraudEvent.parse({ ...valid, details: {} }).details).toEqual({});
    });

    it('accepts admin audit event with info severity', () => {
      const adminEvent = {
        accountId: 'admin',
        timestamp: '2026-04-12T00:00:00Z',
        eventType: 'admin.login',
        severity: 'info',
        details: { ip: '10.0.0.1' },
      };
      const parsed = FraudEvent.parse(adminEvent);
      expect(parsed.eventType).toBe('admin.login');
      expect(parsed.severity).toBe('info');
    });
  });

  describe('FraudTally', () => {
    const valid = { accountId: 'acct-1', windowKey: 'min-2026-04-06T00:00', eventCount: 0 };

    it('accepts valid tally with zero count', () => {
      expect(FraudTally.parse(valid).eventCount).toBe(0);
    });

    it('rejects negative eventCount', () => {
      expect(() => FraudTally.parse({ ...valid, eventCount: -1 })).toThrow();
    });

    it('accepts optional lastEventAt', () => {
      expect(
        FraudTally.parse({ ...valid, lastEventAt: '2026-04-06T00:00:00Z' }).lastEventAt,
      ).toBeTruthy();
    });

    it('rejects empty windowKey', () => {
      expect(() => FraudTally.parse({ ...valid, windowKey: '' })).toThrow();
    });
  });

  describe('VelocityWindow', () => {
    it('accepts valid thresholds', () => {
      expect(VelocityWindow.parse({ maxPerMinute: 10, maxPerHour: 100 })).toEqual({
        maxPerMinute: 10,
        maxPerHour: 100,
      });
    });

    it('rejects zero maxPerMinute', () => {
      expect(() => VelocityWindow.parse({ maxPerMinute: 0, maxPerHour: 100 })).toThrow();
    });

    it('rejects non-integer maxPerHour', () => {
      expect(() => VelocityWindow.parse({ maxPerMinute: 1, maxPerHour: 1.5 })).toThrow();
    });
  });

  describe('AmountThresholds', () => {
    it('accepts both fields present', () => {
      expect(AmountThresholds.parse({ minWei: '100', maxWei: '9999' })).toEqual({
        minWei: '100',
        maxWei: '9999',
      });
    });

    it('accepts empty object (both optional)', () => {
      expect(AmountThresholds.parse({})).toEqual({});
    });

    it('rejects non-digit minWei', () => {
      expect(() => AmountThresholds.parse({ minWei: '-5' })).toThrow();
    });

    it('rejects non-digit maxWei', () => {
      expect(() => AmountThresholds.parse({ maxWei: '1e18' })).toThrow();
    });
  });
});

// ─── exchange.schema ─────────────────────────────────────────────

describe('exchange.schema', () => {
  describe('SupportedExchange', () => {
    it('accepts any non-empty string (stub adapters deleted)', () => {
      expect(SupportedExchange.parse('moonpay')).toBe('moonpay');
      expect(SupportedExchange.parse('custom-adapter')).toBe('custom-adapter');
    });

    it('rejects empty string', () => {
      expect(() => SupportedExchange.parse('')).toThrow();
    });
  });

  describe('QuoteRequest', () => {
    const valid = { fiatCurrency: 'USD', fiatAmount: 100, cryptoAsset: 'USDC' };

    it('accepts valid request', () => {
      expect(QuoteRequest.parse(valid)).toEqual(valid);
    });

    it('accepts optional exchange', () => {
      expect(QuoteRequest.parse({ ...valid, exchange: 'moonpay' }).exchange).toBe('moonpay');
    });

    it('allows omitting exchange', () => {
      expect(QuoteRequest.parse(valid).exchange).toBeUndefined();
    });

    it('rejects fiatAmount of 0', () => {
      expect(() => QuoteRequest.parse({ ...valid, fiatAmount: 0 })).toThrow();
    });

    it('rejects negative fiatAmount', () => {
      expect(() => QuoteRequest.parse({ ...valid, fiatAmount: -50 })).toThrow();
    });

    it('accepts fiatAmount at max (50000)', () => {
      expect(QuoteRequest.parse({ ...valid, fiatAmount: 50000 }).fiatAmount).toBe(50000);
    });

    it('rejects fiatAmount over max', () => {
      expect(() => QuoteRequest.parse({ ...valid, fiatAmount: 50001 })).toThrow();
    });

    it.each(['USD', 'EUR', 'GBP'])('accepts fiat currency "%s"', (c) => {
      expect(QuoteRequest.parse({ ...valid, fiatCurrency: c }).fiatCurrency).toBe(c);
    });

    it('rejects unsupported fiat currency', () => {
      expect(() => QuoteRequest.parse({ ...valid, fiatCurrency: 'JPY' })).toThrow();
    });

    it.each(['USDC', 'XRP', 'ETH'])('accepts crypto asset "%s"', (a) => {
      expect(QuoteRequest.parse({ ...valid, cryptoAsset: a }).cryptoAsset).toBe(a);
    });

    it('rejects unsupported crypto asset', () => {
      expect(() => QuoteRequest.parse({ ...valid, cryptoAsset: 'BTC' })).toThrow();
    });
  });
});

// ─── idempotency.schema ──────────────────────────────────────────

describe('idempotency.schema', () => {
  describe('IdempotencyKey', () => {
    it('accepts valid UUID', () => {
      expect(IdempotencyKey.parse('550e8400-e29b-41d4-a716-446655440000')).toBeTruthy();
    });

    it('rejects non-UUID', () => {
      expect(() => IdempotencyKey.parse('abc')).toThrow();
    });
  });

  describe('IdempotencyRecord', () => {
    const valid = {
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      status: 'in_progress',
      createdAt: '2026-04-06T00:00:00Z',
      ttl: 86400,
    };

    it('accepts valid in_progress record', () => {
      expect(IdempotencyRecord.parse(valid).status).toBe('in_progress');
    });

    it('accepts completed record with all optional fields', () => {
      const completed = {
        ...valid,
        status: 'completed',
        statusCode: 200,
        responseBody: '{"ok":true}',
        responseHeaders: { 'content-type': 'application/json' },
        completedAt: '2026-04-06T00:01:00Z',
      };
      expect(IdempotencyRecord.parse(completed).statusCode).toBe(200);
    });

    it('rejects invalid status', () => {
      expect(() => IdempotencyRecord.parse({ ...valid, status: 'pending' })).toThrow();
    });

    it('rejects missing ttl', () => {
      const { ttl: _ttl, ...rest } = valid;
      expect(() => IdempotencyRecord.parse(rest)).toThrow();
    });

    it('rejects non-integer ttl', () => {
      expect(() => IdempotencyRecord.parse({ ...valid, ttl: 1.5 })).toThrow();
    });

    it('rejects non-integer statusCode', () => {
      expect(() => IdempotencyRecord.parse({ ...valid, statusCode: 200.5 })).toThrow();
    });
  });
});

// ─── rate-limit.schema ───────────────────────────────────────────

describe('rate-limit.schema', () => {
  describe('RateLimitBucket', () => {
    const valid = {
      accountId: '550e8400-e29b-41d4-a716-446655440000',
      tokens: 100,
      lastRefillAt: '2026-04-06T00:00:00Z',
      capacity: 1000,
      refillRate: 10,
    };

    it('accepts valid bucket', () => {
      expect(RateLimitBucket.parse(valid).capacity).toBe(1000);
    });

    it('accepts tokens at zero', () => {
      expect(RateLimitBucket.parse({ ...valid, tokens: 0 }).tokens).toBe(0);
    });

    it('rejects negative tokens', () => {
      expect(() => RateLimitBucket.parse({ ...valid, tokens: -1 })).toThrow();
    });

    it('rejects zero capacity', () => {
      expect(() => RateLimitBucket.parse({ ...valid, capacity: 0 })).toThrow();
    });

    it('rejects negative capacity', () => {
      expect(() => RateLimitBucket.parse({ ...valid, capacity: -10 })).toThrow();
    });

    it('rejects non-integer capacity', () => {
      expect(() => RateLimitBucket.parse({ ...valid, capacity: 10.5 })).toThrow();
    });

    it('rejects zero refillRate', () => {
      expect(() => RateLimitBucket.parse({ ...valid, refillRate: 0 })).toThrow();
    });

    it('rejects negative refillRate', () => {
      expect(() => RateLimitBucket.parse({ ...valid, refillRate: -1 })).toThrow();
    });

    it('accepts composite IP-bucket keys', () => {
      expect(RateLimitBucket.parse({ ...valid, accountId: 'health#203.0.113.7' }).accountId).toBe(
        'health#203.0.113.7',
      );
      expect(RateLimitBucket.parse({ ...valid, accountId: 'admin#203.0.113.7' }).accountId).toBe(
        'admin#203.0.113.7',
      );
      expect(RateLimitBucket.parse({ ...valid, accountId: 'signup#203.0.113.7' }).accountId).toBe(
        'signup#203.0.113.7',
      );
    });

    it('rejects empty accountId', () => {
      expect(() => RateLimitBucket.parse({ ...valid, accountId: '' })).toThrow();
    });

    it('rejects invalid lastRefillAt', () => {
      expect(() => RateLimitBucket.parse({ ...valid, lastRefillAt: 'yesterday' })).toThrow();
    });
  });
});

// ─── stripe.schema ───────────────────────────────────────────────

describe('stripe.schema', () => {
  describe('StripePriceToPlans', () => {
    it('maps starter price correctly', () => {
      expect(StripePriceToPlans.price_starter_monthly).toBe('starter');
    });

    it('maps growth price correctly', () => {
      expect(StripePriceToPlans.price_growth_monthly).toBe('growth');
    });

    it('maps scale price correctly', () => {
      expect(StripePriceToPlans.price_scale_monthly).toBe('scale');
    });
  });

  describe('HANDLED_EVENTS', () => {
    it('contains exactly 3 events', () => {
      expect(HANDLED_EVENTS).toHaveLength(3);
    });

    it.each([
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ])('includes "%s"', (evt) => {
      expect(HANDLED_EVENTS).toContain(evt);
    });
  });

  describe('StripeSubscriptionEvent', () => {
    const valid = {
      id: 'evt_123',
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          items: {
            data: [{ price: { lookup_key: 'price_starter_monthly' } }],
          },
        },
      },
    };

    it('accepts valid event', () => {
      expect(StripeSubscriptionEvent.parse(valid).id).toBe('evt_123');
    });

    it('accepts event without price lookup_key', () => {
      const noKey = {
        ...valid,
        data: {
          object: {
            ...valid.data.object,
            items: { data: [{ price: {} }] },
          },
        },
      };
      expect(StripeSubscriptionEvent.parse(noKey)).toBeTruthy();
    });

    it('rejects empty items array', () => {
      const empty = {
        ...valid,
        data: {
          object: {
            ...valid.data.object,
            items: { data: [] },
          },
        },
      };
      expect(() => StripeSubscriptionEvent.parse(empty)).toThrow();
    });

    it('rejects missing customer', () => {
      const noCust = {
        ...valid,
        data: {
          object: {
            id: 'sub_123',
            status: 'active',
            items: valid.data.object.items,
          },
        },
      };
      expect(() => StripeSubscriptionEvent.parse(noCust)).toThrow();
    });

    it('rejects empty id', () => {
      expect(() => StripeSubscriptionEvent.parse({ ...valid, id: '' })).toThrow();
    });

    it('rejects empty type', () => {
      expect(() => StripeSubscriptionEvent.parse({ ...valid, type: '' })).toThrow();
    });
  });
});

// ─── health.schema ───────────────────────────────────────────────

describe('health.schema', () => {
  describe('HealthCheckResult', () => {
    it('accepts valid passing check', () => {
      const result = HealthCheckResult.parse({ name: 'dynamodb', ok: true, latencyMs: 5 });
      expect(result.name).toBe('dynamodb');
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts valid failing check with error', () => {
      const result = HealthCheckResult.parse({
        name: 'secrets',
        ok: false,
        latencyMs: 3,
        error: 'Access denied',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Access denied');
    });

    it('rejects missing name', () => {
      expect(() => HealthCheckResult.parse({ ok: true, latencyMs: 1 })).toThrow();
    });

    it('rejects missing ok', () => {
      expect(() => HealthCheckResult.parse({ name: 'x', latencyMs: 1 })).toThrow();
    });

    it('rejects missing latencyMs', () => {
      expect(() => HealthCheckResult.parse({ name: 'x', ok: true })).toThrow();
    });

    it('rejects negative latencyMs', () => {
      expect(() => HealthCheckResult.parse({ name: 'x', ok: true, latencyMs: -1 })).toThrow();
    });
  });

  describe('HealthReadyResponse', () => {
    it('accepts valid healthy response', () => {
      const result = HealthReadyResponse.parse({
        ok: true,
        stage: 'dev',
        checks: [{ name: 'dynamodb', ok: true, latencyMs: 5 }],
      });
      expect(result.ok).toBe(true);
      expect(result.checks).toHaveLength(1);
    });

    it('accepts empty checks array', () => {
      const result = HealthReadyResponse.parse({ ok: true, stage: 'dev', checks: [] });
      expect(result.checks).toHaveLength(0);
    });

    it('rejects missing ok', () => {
      expect(() => HealthReadyResponse.parse({ stage: 'dev', checks: [] })).toThrow();
    });

    it('rejects missing stage', () => {
      expect(() => HealthReadyResponse.parse({ ok: true, checks: [] })).toThrow();
    });

    it('rejects missing checks', () => {
      expect(() => HealthReadyResponse.parse({ ok: true, stage: 'dev' })).toThrow();
    });
  });
});
