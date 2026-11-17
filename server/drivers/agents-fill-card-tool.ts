// The agents catalog's fill_card tool: the harness route (server/routes/fill-card.ts) decides whether this is the ask
// or the approved fill, and answers in words, never a card value.
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";

export const FILL_CARD_TOOL = "fill_card";

export async function callFillCardTool(context: ToolCallContext, args: Record<string, unknown>): Promise<ToolCallResult> {
  const pick = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const card = pick(args.card, 80);
  const r = await context.client.api("/api/internal/fill-card", {
    method: "POST",
    body: JSON.stringify({ fromBotId: context.botId, fromThreadId: context.threadId, amount: pick(args.amount, 40), item: pick(args.item, 160), ...(card ? { card } : {}) }),
  });
  return { text: typeof r.text === "string" && r.text ? r.text : "fill_card did not answer. Call request_sign_in so the person pays themselves.", ...(r.ok === true ? {} : { isError: true }) };
}
