// What every bot browser call shares: its time budget, its timing line and the refusals it can get before it runs.
import { HARNESS_CALL_BUDGET_MS } from "../harness-budget.ts";

export const BROWSER_CONTROL_REFUSAL = "Browser tools are paused while a person controls this browser. Wait for them to hand control back; do not try another browser or execution tool.";
export const BROWSER_UPLOAD_TOOL = "agent_browser_upload";

/** One bot call, lane wait included, answers within `callBudgetMs`. */
export const BROWSER_CALL_DEFAULTS = { laneWaitMs: 30_000, callBudgetMs: HARNESS_CALL_BUDGET_MS } as const;

/** One timed browser call (ms), logged with OMB_BROWSER_TIMING=1; `inFlight` is this session's work already running. */
export interface BrowserTiming {
  session: string;
  tool: string;
  outcome: "ok" | "error";
  totalMs: number;
  chars?: number;
  inFlight: number;
}

export function formatBrowserTiming(timing: BrowserTiming): string {
  const parts = [`browser timing: ${timing.tool} ${timing.outcome}`, `total=${Math.round(timing.totalMs)}ms`];
  if (timing.chars !== undefined) parts.push(`chars=${timing.chars}`);
  parts.push(`inflight=${timing.inFlight}`, `session=${timing.session}`);
  return parts.join(" ");
}
