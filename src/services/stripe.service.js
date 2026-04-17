import { createHmac, timingSafeEqual } from 'node:crypto';
import { tenantsRepo } from '../repositories/tenants.repo.js';
import { UnauthorizedError, ValidationError } from '../lib/errors.js';
import {
  StripeSubscriptionEvent,
  StripePriceToPlans,
  HANDLED_EVENTS,
} from '../validators/stripe.schema.js';
import { planChanged } from '../lib/metrics.js';

const TOLERANCE_SECONDS = 300;

export const stripeService = {
  verifySignature(payload, signatureHeader, secret) {
    if (!signatureHeader || !secret) throw new UnauthorizedError('Missing Stripe signature');

    const parts = Object.fromEntries(
      signatureHeader.split(',').map((p) => {
        const [k, v] = p.split('=');
        return [k, v];
      }),
    );

    const timestamp = Number(parts.t);
    if (!timestamp || Number.isNaN(timestamp))
      throw new UnauthorizedError('Invalid Stripe timestamp');

    const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
    if (age > TOLERANCE_SECONDS) throw new UnauthorizedError('Stripe signature expired');

    const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');

    const sig = parts.v1;
    if (!sig) throw new UnauthorizedError('Missing v1 signature');

    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedError('Stripe signature mismatch');
    }
  },

  async handleSubscriptionEvent(body) {
    const event = StripeSubscriptionEvent.parse(body);
    if (!HANDLED_EVENTS.includes(event.type)) return { action: 'ignored', eventType: event.type };

    const sub = event.data.object;
    const customerId = sub.customer;

    const tenant = await tenantsRepo.getByStripeCustomerId(customerId);
    if (!tenant) throw new ValidationError(`No tenant for Stripe customer ${customerId}`);

    if (event.type === 'customer.subscription.deleted') {
      await tenantsRepo.updatePlan(tenant.accountId, 'free');
      planChanged({ accountId: tenant.accountId, plan: 'free', action: 'downgraded' });
      return { action: 'downgraded', accountId: tenant.accountId, plan: 'free' };
    }

    if (sub.status !== 'active')
      return { action: 'ignored', reason: `subscription status: ${sub.status}` };

    const lookupKey = sub.items.data[0]?.price?.lookup_key;
    const plan = lookupKey ? StripePriceToPlans[lookupKey] : undefined;
    if (!plan) throw new ValidationError(`Unknown price lookup_key: ${lookupKey}`);

    await tenantsRepo.updatePlan(tenant.accountId, plan);
    planChanged({ accountId: tenant.accountId, plan, action: 'updated' });
    return { action: 'updated', accountId: tenant.accountId, plan };
  },
};
