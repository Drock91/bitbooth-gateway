import { stripeService } from '../services/stripe.service.js';
import { jsonResponse } from '../middleware/error.middleware.js';

export async function handleStripeWebhook(event, { log, stripeWebhookSecret }) {
  const payload = event.body ?? '';
  const sig =
    (event.headers ?? {})['stripe-signature'] ?? event.headers?.['Stripe-Signature'] ?? '';

  stripeService.verifySignature(payload, sig, stripeWebhookSecret);

  const body = JSON.parse(payload);
  const result = await stripeService.handleSubscriptionEvent(body);

  log.info({ result }, 'stripe webhook processed');
  return jsonResponse(200, { ok: true, ...result });
}
