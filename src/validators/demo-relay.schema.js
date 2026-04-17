import { z } from 'zod';

// The demo relay endpoint takes no body — it generates an ephemeral
// recipient server-side and sends a fixed tiny amount. Empty object is
// the only valid body so we don't expose any user-controlled inputs.
export const DemoRelayRequest = z.object({}).strict();
