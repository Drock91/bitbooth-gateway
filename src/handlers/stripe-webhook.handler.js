import { handleStripeWebhook } from '../controllers/stripe.controller.js';
import { toHttpResponse } from '../middleware/error.middleware.js';
import { getSecret } from '../lib/secrets.js';
import { getConfig } from '../lib/config.js';
import { withRequestLogging } from '../middleware/request-log.middleware.js';
import { withBodySizeLimit } from '../middleware/body-size.middleware.js';
import { withGracefulShutdown } from '../middleware/shutdown.middleware.js';
import { withSecurityHeaders } from '../middleware/security-headers.middleware.js';

export default withGracefulShutdown(
  withSecurityHeaders(
    withRequestLogging(
      withBodySizeLimit(async (event, { correlationId, log }) => {
        try {
          const config = getConfig();
          const stripeWebhookSecret = await getSecret(config.secretArns.stripe);

          return await handleStripeWebhook(event, { log, stripeWebhookSecret });
        } catch (err) {
          return toHttpResponse(err, correlationId);
        }
      }),
    ),
  ),
);
