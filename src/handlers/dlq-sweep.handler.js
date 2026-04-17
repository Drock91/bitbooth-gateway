import { sweepDlq } from '../services/webhook-dlq.service.js';
import { logger } from '../lib/logger.js';

export const handler = async () => {
  const log = logger.child({ handler: 'dlq-sweep' });
  log.info('DLQ sweep started');

  const result = await sweepDlq();
  log.info(result, 'DLQ sweep completed');

  return result;
};
