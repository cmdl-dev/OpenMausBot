// `browserEngine` in config.json.
import { z } from "zod";

import { browserEgressConfigSchema, type BrowserEgressConfig } from "./egress/policy.ts";

/** Not strict: `engine` and `attachCdpUrl` from before agent-browser was removed are dropped when a config.json is read. */
export const browserEngineConfigSchema = z.object({
  idleTimeoutMinutes: z.number().int().min(1).max(60).optional(), // an unused browser closes after this; 10 when unset, 3 on MausBot Cloud
  egress: browserEgressConfigSchema.optional(),
});

export interface BrowserEngineConfig {
  idleTimeoutMinutes?: number;
  egress?: BrowserEgressConfig;
}
