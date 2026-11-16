// Paying with a saved card: the Pay cards a bot's fill_card shows, the person's answer to one, and the fill an approval
// allows.
import type { ServerResponse } from "node:http";

import { json } from "../harness/http.ts";
import { createFillCardTurn, type FillCardTurnDeps } from "./fill-card-turn.ts";
import { PaymentRequestService, type PaymentRequestOptions } from "./payment-requests.ts";

export type PaymentsDeps = Omit<FillCardTurnDeps, "payments"> & Omit<PaymentRequestOptions, "now">;

export function createPayments(deps: PaymentsDeps) {
  const paymentRequests = new PaymentRequestService(deps);
  const { fillCardForTurn } = createFillCardTurn({ ...deps, payments: paymentRequests });

  /** The person typed a card into a card-entry ask. */
  function providePaymentCard(res: ServerResponse, args: { botId: string; threadId: string; requestId: string; body: Record<string, unknown> }, ownerReview: boolean): void {
    const outcome = paymentRequests.provideCard(args, ownerReview);
    json(res, outcome.status, outcome.body);
  }

  /** False when the card is no Pay card. */
  function resolveAndSendPayment(res: ServerResponse, args: { botId: string; threadId: string; requestId: string; behavior: string }, ownerReview: boolean): boolean {
    const outcome = paymentRequests.respond(args, ownerReview);
    if (!outcome) return false;
    json(res, outcome.status, outcome.body);
    return true;
  }

  return { paymentRequests, fillCardForTurn, resolveAndSendPayment, providePaymentCard };
}
