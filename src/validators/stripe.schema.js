import { z } from 'zod';

export const StripePriceToPlans = {
  price_starter_monthly: 'starter',
  price_growth_monthly: 'growth',
  price_scale_monthly: 'scale',
};

export const StripeSubscriptionEvent = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({
    object: z.object({
      id: z.string().min(1),
      customer: z.string().min(1),
      status: z.string().min(1),
      items: z.object({
        data: z
          .array(
            z.object({
              price: z.object({
                lookup_key: z.string().optional(),
              }),
            }),
          )
          .min(1),
      }),
    }),
  }),
});

export const HANDLED_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];
