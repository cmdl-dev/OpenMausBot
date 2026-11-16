import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

/** Only dispatch inside the internal capability gate, with its guarded body reader. The global route table must never
 * register this endpoint. `settled` throws when the turn stopped while the card was filled, so it gets no answer. */
export function createInternalFillCardRoutes(deps: {
  readBody(): ReturnType<RouteContext["readBody"]>;
  fill(body: { amount?: unknown; item?: unknown; card?: unknown }): Promise<{ ok: boolean; text: string }>;
  settled(): void;
}): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (method !== "POST" || path !== "/api/internal/fill-card") return PASS;
    const body = await deps.readBody();
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "request body must be a JSON object" });
    const outcome = await deps.fill({ amount: body.amount, item: body.item, card: body.card });
    deps.settled();
    return json(res, 200, outcome);
  };
}
