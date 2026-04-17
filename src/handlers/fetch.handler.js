import { postFetch } from '../controllers/fetch.controller.js';
import {
  toHttpResponse,
  paymentRequiredResponse,
  jsonResponse,
} from '../middleware/error.middleware.js';
import { isAppError } from '../lib/errors.js';
import { withRequestLogging } from '../middleware/request-log.middleware.js';
import { withApiVersion } from '../middleware/versioning.middleware.js';
import { withBodySizeLimit } from '../middleware/body-size.middleware.js';
import { withGracefulShutdown } from '../middleware/shutdown.middleware.js';
import { withSecurityHeaders } from '../middleware/security-headers.middleware.js';

export const handler = withGracefulShutdown(
  withSecurityHeaders(
    withRequestLogging(
      withBodySizeLimit(
        withApiVersion(async (event, { correlationId }) => {
          if (event.httpMethod !== 'POST' || event.path !== '/v1/fetch') {
            return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no route' } });
          }

          try {
            return await postFetch(event);
          } catch (err) {
            if (isAppError(err) && err.status === 402)
              return paymentRequiredResponse(err, correlationId);
            return toHttpResponse(err, correlationId);
          }
        }),
      ),
    ),
  ),
);
