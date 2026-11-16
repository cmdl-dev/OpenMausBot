// A bot's ask to pay: a Pay / Cancel card for a saved card, or a secure card the person types a card into, and the one
// fill an approval allows. A typed card the person does not save stays in this process's memory for that fill only.
import { randomUUID } from "node:crypto";

import { amountValue, cardBrand, cardLabel } from "../../shared/payment-cards.ts";
import { PAYMENT_APPROVAL_MS, type PaymentRequest } from "../../shared/payment-request.ts";
import type { OptionCardData } from "../../shared/wire.ts";
import { newId } from "../contracts.ts";
import { parseCardFields } from "../routes/vault-cards.ts";
import { serverLine } from "../server-lines.ts";
import type { NewCard, StoredCard, VaultStore } from "../vault-store.ts";

type RequestFrom = { botId: string; name: string; color: string };
type Decision = "card-shown" | "user-approved" | "user-denied";
type CardLine = { id: string; card?: OptionCardData };
type Respond = { status: number; body: Record<string, unknown> };
/** A typed card not saved to the Vault, kept for its one approved fill. */
type HeldCard = Omit<StoredCard, "id" | "bots" | "createdAt" | "updatedAt" | "lastUsedAt" | "name"> & { expiresAt: number };

export const PAY_OPTION = "Pay";
export const ADD_CARD_OPTION = "Add card";
/** Phones send deny only for Deny, Cancel, Dismiss or Skip. */
const CANCEL_OPTION = "Cancel";
const HELD_PREFIX = "held:";
const CARD_SHOWN = "A Pay card is now visible to the person. End this turn now and wait: OpenMausBot resumes you with their answer. Never ask for card details in chat.";
const ENTRY_SHOWN = "A secure card is now visible where the person can add a card for this payment, and save it to the Vault if they choose. End this turn now and wait: OpenMausBot resumes you with their answer. Never ask for card details in chat.";

export function paymentDecisionText(request: PaymentRequest): string {
  const result = request.result;
  const said = `OpenMausBot payment decision ${request.requestId}:`;
  if (!result) return `${said} not answered yet.`;
  if (result.state === "approved") {
    const how = request.needsCard
      ? `The person added ${request.cardLabel}${request.saved ? " and saved it to the Vault for later" : " for this payment only"}, approving paying ${request.amount} at ${request.site}.`
      : `The person approved paying ${request.amount} at ${request.site} with ${request.cardLabel}.`;
    return `${said} ${how} On that checkout page in your browser, call fill_card again with the same amount: OpenMausBot types the card into the page, and you never see it. Then press the page's own pay or place-order button once, and check the order went through. The approval is for one fill in the next ${PAYMENT_APPROVAL_MS / 60_000} minutes.`;
  }
  return `${said} ${result.text}`;
}

export interface PaymentRequestOptions {
  store: {
    messagesFor(threadId: string): readonly CardLine[];
    appendMessage(threadId: string, message: { role: "bot"; kind: "options"; card: OptionCardData; from?: RequestFrom }): { id: string };
    patchMessage(threadId: string, messageId: string, patch: { card: OptionCardData }): unknown;
  };
  /** Where a card the person saves goes. */
  vault: Pick<VaultStore, "saveCard">;
  /** A typed card's number and code are masked wherever text crosses to a bot. */
  remember(value: string, kind: "password" | "code"): void;
  /** Hands the decision to the turn parked on this card; false when none took it. */
  answer(threadId: string, messageId: string, text: string): boolean;
  decide(row: { threadId: string; requestId: string; botId: string; summary: string; decision: Decision }): void;
  language?(threadId: string): string | undefined;
  now?(): number;
}

export class PaymentRequestService {
  private readonly options: PaymentRequestOptions;
  private readonly now: () => number;
  private readonly held = new Map<string, HeldCard>();
  constructor(options: PaymentRequestOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  /** Only the newest ask of this bot in this conversation can be answered: every earlier open one expires. */
  propose(request: Omit<PaymentRequest, "requestId" | "result" | "usedAt" | "resumed" | "saved">, from?: RequestFrom): { requestId: string; messageId: string; text: string } {
    const { store } = this.options;
    for (const line of store.messagesFor(request.threadId)) {
      const card = line.card, earlier = card?.paymentRequest;
      if (!card || !earlier || earlier.botId !== request.botId) continue;
      if (!card.answered && !card.dismissed && !card.expired) store.patchMessage(request.threadId, line.id, { card: { ...card, expired: true, options: [] } });
    }
    const requestId = newId();
    const language = this.options.language?.(request.threadId);
    const entry = request.needsCard === true;
    const card: OptionCardData = {
      title: serverLine(language, entry ? "server.payment.entry.title" : "server.payment.card.title", { amount: request.amount, site: request.site }),
      subtitle: entry ? request.item : serverLine(language, "server.payment.card.subtitle", { item: request.item, card: request.cardLabel }),
      options: [entry ? ADD_CARD_OPTION : PAY_OPTION, CANCEL_OPTION], requestId, tool: "fill_card", fixedOptions: true, paymentRequest: { ...request, requestId },
    };
    const message = store.appendMessage(request.threadId, { role: "bot", kind: "options", ...(from ? { from } : {}), card });
    this.options.decide({ threadId: request.threadId, requestId, botId: request.botId, summary: `${card.title}\n${card.subtitle}`, decision: "card-shown" });
    return { requestId, messageId: message.id, text: entry ? ENTRY_SHOWN : CARD_SHOWN };
  }

  /** Null when no payment card has this id. Paying needs the desktop app, or an admin on a paired device. */
  respond(args: { botId: string; threadId: string; requestId: string; behavior: string }, ownerReview: boolean): Respond | null {
    const found = this.open(args);
    if (!found || "status" in found) return found;
    const { message, card, request } = found;
    if (args.behavior !== "allow" && args.behavior !== "deny") return { status: 400, body: { error: `Answer with ${card.options.join(" or ")}.` } };
    if (args.behavior === "allow" && request.needsCard) return { status: 409, body: { error: "Add the card on this card in the chat, in the desktop app." } };
    if (args.behavior === "allow" && !ownerReview) return { status: 403, body: { error: NOT_HERE } };
    if (card.answered || card.dismissed || card.expired) return this.settled(args.threadId, message.id, true);
    const at = this.now();
    const result: NonNullable<PaymentRequest["result"]> = args.behavior === "allow"
      ? { state: "approved", text: "approved", at }
      : { state: "declined", text: `The person declined paying ${request.amount} at ${request.site}. Do not pay, and do not ask again unless they ask you to.`, at };
    this.record(args.threadId, message.id, { ...request, result }, args.behavior);
    return this.settled(args.threadId, message.id, false);
  }

  /** The person typed a card into a `needsCard` ask: it approves that payment with that card, saved to the Vault for the
   * asking bot when `save`, otherwise held in memory for the one fill. */
  provideCard(args: { botId: string; threadId: string; requestId: string; body: Record<string, unknown> }, ownerReview: boolean): Respond {
    const found = this.open(args);
    if (!found) return { status: 404, body: { error: "This card is no longer here." } };
    if ("status" in found) return found;
    const { message, card, request } = found;
    if (!request.needsCard) return { status: 409, body: { error: "This payment uses a saved card: answer it with Pay." } };
    if (card.answered || card.dismissed || card.expired) return { status: 409, body: { error: "This card was already answered, or a newer one replaced it." } };
    if (!ownerReview) return { status: 403, body: { error: NOT_HERE } };
    const fields = parseCardFields(args.body, { creating: true });
    if (!fields.ok) return { status: 400, body: { error: fields.error } };
    const value = fields.value;
    const number = value.number!;
    this.options.remember(number, "password");
    if (value.cvc) this.options.remember(value.cvc, "code");
    const save = args.body.save === true;
    let cardId: string;
    let label: string;
    if (save) {
      const newCard: NewCard = {
        name: value.name ?? "", number, expMonth: value.expMonth!, expYear: value.expYear!, bots: [request.botId],
        ...(value.cvc ? { cvc: value.cvc } : {}), ...(value.holder ? { holder: value.holder } : {}), ...(value.postalCode ? { postalCode: value.postalCode } : {}),
      };
      const saved = this.options.vault.saveCard(newCard);
      cardId = saved.id;
      label = cardLabel(saved);
    } else {
      cardId = `${HELD_PREFIX}${randomUUID()}`;
      this.held.set(cardId, {
        number, expMonth: value.expMonth!, expYear: value.expYear!, expiresAt: this.now() + PAYMENT_APPROVAL_MS,
        ...(value.cvc ? { cvc: value.cvc } : {}), ...(value.holder ? { holder: value.holder } : {}), ...(value.postalCode ? { postalCode: value.postalCode } : {}),
      });
      label = cardLabel({ name: "", brand: cardBrand(number), last4: number.slice(-4) });
    }
    const result: NonNullable<PaymentRequest["result"]> = { state: "approved", text: "approved", at: this.now() };
    this.record(args.threadId, message.id, { ...request, cardId, cardLabel: label, ...(save ? { saved: true as const } : {}), result }, "allow");
    return this.settled(args.threadId, message.id, false);
  }

  /** The newest approval this bot may fill now in this conversation on `site` for this total: unused and within the window. */
  approval(botId: string, threadId: string, site: string, amount: string): { messageId: string; request: PaymentRequest } | null {
    const lines = this.options.store.messagesFor(threadId);
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index]!, request = line.card?.paymentRequest;
      if (!request || request.botId !== botId || request.threadId !== threadId || request.site !== site) continue;
      if (request.result?.state !== "approved" || request.usedAt !== undefined || !request.cardId) continue;
      if (this.now() - request.result.at > PAYMENT_APPROVAL_MS) continue;
      if (amountValue(request.amount) === amountValue(amount)) return { messageId: line.id, request };
    }
    return null;
  }

  /** A typed card the person did not save; null once used, expired, or lost to a restart. */
  heldCard(cardId: string): Omit<HeldCard, "expiresAt"> | null {
    if (!cardId.startsWith(HELD_PREFIX)) return null;
    const card = this.held.get(cardId);
    if (!card || card.expiresAt <= this.now()) { this.held.delete(cardId); return null; }
    const { expiresAt: _expiresAt, ...values } = card;
    return values;
  }

  isHeld(cardId: string): boolean {
    return cardId.startsWith(HELD_PREFIX);
  }

  /** The approval's one fill happened; a held card goes with it. */
  use(threadId: string, messageId: string): void {
    const card = this.options.store.messagesFor(threadId).find((line) => line.id === messageId)?.card, request = card?.paymentRequest;
    if (!card || !request || request.usedAt !== undefined) return;
    this.held.delete(request.cardId);
    this.options.store.patchMessage(threadId, messageId, { card: { ...card, paymentRequest: { ...request, usedAt: this.now() } } });
  }

  decided(threadId: string, messageId: string): boolean {
    return Boolean(this.options.store.messagesFor(threadId).find((line) => line.id === messageId)?.card?.paymentRequest?.result);
  }

  /** Hands the card's decision to a parked turn; true once that turn took it. */
  resume(threadId: string, messageId: string, answer: (text: string) => boolean): boolean {
    const card = this.options.store.messagesFor(threadId).find((line) => line.id === messageId)?.card, request = card?.paymentRequest;
    if (!card || !request?.result || !answer(paymentDecisionText(request))) return false;
    if (!request.resumed) this.options.store.patchMessage(threadId, messageId, { card: { ...card, paymentRequest: { ...request, resumed: true } } });
    return true;
  }

  private open(args: { botId: string; threadId: string; requestId: string }): { message: CardLine; card: OptionCardData; request: PaymentRequest } | Respond | null {
    const message = this.options.store.messagesFor(args.threadId).find((line) => line.card?.requestId === args.requestId && line.card.paymentRequest);
    const card = message?.card, request = card?.paymentRequest;
    if (!message || !card || !request) return null;
    if (request.botId !== args.botId || request.threadId !== args.threadId) return { status: 403, body: { error: "This card belongs to another conversation." } };
    return { message, card, request };
  }

  private record(threadId: string, messageId: string, settled: PaymentRequest, behavior: "allow" | "deny"): void {
    const card = this.options.store.messagesFor(threadId).find((line) => line.id === messageId)?.card;
    if (!card) return;
    this.options.store.patchMessage(threadId, messageId, { card: { ...card, answered: behavior, paymentRequest: settled } });
    this.options.decide({ threadId, requestId: settled.requestId, botId: settled.botId, summary: `${card.title}\n${card.subtitle}`,
      decision: behavior === "allow" ? "user-approved" : "user-denied" });
  }

  private settled(threadId: string, messageId: string, already: boolean): Respond {
    const request = this.options.store.messagesFor(threadId).find((line) => line.id === messageId)?.card?.paymentRequest;
    if (request?.result && !request.resumed) this.resume(threadId, messageId, (text) => this.options.answer(threadId, messageId, text));
    return { status: 200, body: { ok: true, outcome: request?.result?.state === "approved" ? "allowed-once" : "rejected", alreadySettled: already } };
  }
}

const NOT_HERE = "Approve payments from the desktop app or a paired Full-access device. In a local browser, wait until every bot is idle.";
