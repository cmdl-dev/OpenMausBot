// fill_card for one turn. Without an approval it shows the person a Pay card and the turn ends; with one, the server
// types the card into the checkout as one browser action and answers in words, never a value.
import { loginPageCheck, loginSite } from "../../shared/logins.ts";
import { amountValue, cardExpired, cardLabel, PAYMENT_AMOUNT_MAX, PAYMENT_ITEM_MAX, type VaultCard } from "../../shared/payment-cards.ts";
import { PAYMENT_APPROVAL_MS } from "../../shared/payment-request.ts";
import type { Surface } from "../../shared/wire.ts";
import { BROWSER_CONTROL_REFUSAL } from "../browser-runtime.ts";
import type { StepContext } from "../browser-steps.ts";
import { fillCard, pageShowsAmount, type CardFillDeps, type CardField, type CardValues } from "../card-fill.ts";
import { SECRET_HOLD_MS } from "../login-fill.ts";
import { redactSecretsInText } from "../redact.ts";
import type { BotRecord } from "../store.ts";
import type { VaultStore } from "../vault-store.ts";
import type { PaymentRequestService } from "./payment-requests.ts";

type Spec = { command: string; env: Record<string, string> };
type Turn = { botId: string; threadId: string; generation: string };
type Answer = { ok: boolean; text: string };
type Outcome = { ok: boolean; text: string; held?: { url: string; ms: number } };
type CardInput = Pick<CardFillDeps, "frames" | "read" | "type"> & { pageUrl(): string | null };

export interface FillCardTurnDeps {
  place(bot: BotRecord, threadId: string): Surface | null;
  current(bot: BotRecord, threadId: string): BotRecord;
  builtInBrowserOn(): boolean;
  /** Null while the browser engine is not installed. */
  target(bot: BotRecord, threadId: string): Promise<{ session: string; spec: Spec; env: NodeJS.ProcessEnv } | null>;
  /** Null on a browser that cannot keep a typed card out of screenshots. */
  cardInput(session: string, spec: Spec): CardInput | null;
  claim(turn: Turn, resource: string): boolean;
  withSecretInput(session: string, spec: Spec, fill: () => Promise<Outcome>, ctx: StepContext): Promise<Outcome>;
  cards: Pick<VaultStore, "cardsFor" | "card" | "markUsed">;
  payments: Pick<PaymentRequestService, "approval" | "propose" | "use" | "heldCard" | "isHeld">;
  /** Who asked, on a card in a room; absent in a bot's own chat. */
  from(bot: BotRecord, threadId: string): { botId: string; name: string; color: string } | undefined;
  remember: CardFillDeps["remember"];
  stepContext(bot: BotRecord, turn: Turn): StepContext;
  turnActive?(turn: Turn): boolean;
  now?(): number;
}

const PAY_YOURSELF = "Call request_sign_in with the checkout's address and the reason \"payment\" so the person pays themselves.";
const FIELD_WORDS: Record<CardField, string> = {
  number: "card number", exp: "expiry", expMonth: "expiry month", expYear: "expiry year", cvc: "security code", name: "name on card", postal: "billing ZIP or postal code",
};

function words(fields: readonly CardField[]): string {
  const named = fields.map((field) => FIELD_WORDS[field]);
  return named.length <= 1 ? named.join("") : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
}

function text(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.replace(/\s+/gu, " ").trim().slice(0, max) : "";
}

/** The card the bot named, by its last four digits or its name; the only one when it named none. */
function chosenCard(cards: readonly VaultCard[], wanted: string): VaultCard | { error: string } {
  const listed = cards.map((card) => cardLabel(card)).join("; ");
  if (!wanted) return cards.length === 1 ? cards[0]! : { error: `There are ${cards.length} saved cards you may use: ${listed}. Ask the person which one to pay with, then call fill_card with card set to its last four digits, or to "new" for a card they add now.` };
  const digits = wanted.replace(/\D/gu, "");
  const lower = wanted.toLowerCase();
  const matches = cards.filter((card) => (digits.length === 4 && card.last4 === digits) || (card.name && card.name.toLowerCase() === lower));
  if (matches.length === 1) return matches[0]!;
  return { error: `No single saved card matches ${JSON.stringify(wanted.slice(0, 40))}. The cards you may use: ${listed}. Call fill_card with card set to one card's last four digits.` };
}

export function createFillCardTurn(deps: FillCardTurnDeps) {
  const now = deps.now ?? Date.now;

  async function fillCardForTurn(bot: BotRecord, capability: Turn, raw: { amount?: unknown; item?: unknown; card?: unknown }): Promise<Answer> {
    const threadId = capability.threadId;
    if (deps.place(bot, threadId) !== "browser") {
      return { ok: false, text: `fill_card works only in your own browser, where OpenMausBot checks the checkout's site and keeps the card out of screenshots. Open the checkout with your browser tools, then call fill_card. ${PAY_YOURSELF}` };
    }
    const current = deps.current(bot, threadId);
    if (current.browser === false || current.computer === "off" || !deps.builtInBrowserOn()) {
      return { ok: false, text: `The built-in browser is off for you here, so fill_card has nothing to fill. ${PAY_YOURSELF}` };
    }
    const amount = text(raw.amount, PAYMENT_AMOUNT_MAX);
    const item = text(raw.item, PAYMENT_ITEM_MAX);
    if (!amount || !amountValue(amount)) return { ok: false, text: "fill_card needs amount: the order's total exactly as the checkout shows it, with its currency, such as $42.10." };
    if (!item) return { ok: false, text: "fill_card needs item: a few words on what the person is buying, such as 2 concert tickets for Saturday." };
    const browser = await deps.target(current, threadId);
    if (!browser) return { ok: false, text: `The browser is not available on this computer right now. ${PAY_YOURSELF}` };
    const { session, spec } = browser;
    const input = deps.cardInput(session, spec);
    if (!input) {
      return { ok: false, text: `Paying with a card needs the new browser, which keeps the typed card out of screenshots. The person can turn it on in Settings → Early features → New browser. Until then: ${PAY_YOURSELF}` };
    }
    if (!deps.claim(capability, `browser:${session}`)) return { ok: false, text: "Another conversation is using this browser. Wait until it finishes, then call fill_card again." };
    const page = loginPageCheck(input.pageUrl() ?? "");
    if (!page.ok) {
      return { ok: false, text: page.reason === "insecure"
        ? `This page (${page.pageHost}) is not secure (http, not https). fill_card never pays on it.`
        : "The browser has no checkout page open. Open the checkout page first, then call fill_card." };
    }
    const site = loginSite(page.pageHost);
    try {
      const approved = deps.payments.approval(current.id, threadId, site, amount);
      if (approved) {
        const card = deps.payments.heldCard(approved.request.cardId) ?? deps.cards.card(approved.request.cardId);
        if (!card) {
          return { ok: false, text: deps.payments.isHeld(approved.request.cardId)
            ? "The card the person added is gone: OpenMausBot restarted, or its time ran out. Call fill_card again so they can add it again."
            : "That saved card is gone. Tell the person, and do not pay." };
        }
        const label = approved.request.cardLabel;
        const outcome = await deps.withSecretInput(session, spec, () => fill(card, input, approved.request.amount, page.pageHost, label, capability), deps.stepContext(current, capability));
        if (outcome.ok) {
          deps.payments.use(threadId, approved.messageId);
          if (!deps.payments.isHeld(approved.request.cardId)) deps.cards.markUsed(approved.request.cardId);
        }
        return { ok: outcome.ok, text: outcome.text };
      }
      if (!(await pageShowsAmount(amount, input))) {
        return { ok: false, text: `The total ${amount} does not appear on this page (${page.pageHost}). On the checkout page, call fill_card with the total exactly as it shows it.` };
      }
      const from = deps.from(current, threadId);
      const usable = deps.cards.cardsFor(current.id).filter((card) => !cardExpired(card, now()));
      const wanted = text(raw.card, 80);
      if (!usable.length || wanted.toLowerCase() === "new") {
        const shown = deps.payments.propose({ botId: current.id, threadId, cardId: "", cardLabel: "", needsCard: true, site, amount, item }, from);
        return { ok: true, text: `${shown.text} The card asks them to add a card to pay ${amount} at ${site}, for ${item}.` };
      }
      const chosen = chosenCard(usable, wanted);
      if ("error" in chosen) return { ok: false, text: chosen.error };
      const label = cardLabel(chosen);
      const shown = deps.payments.propose({ botId: current.id, threadId, cardId: chosen.id, cardLabel: label, site, amount, item }, from);
      return { ok: true, text: `${shown.text} The card asks: pay ${amount} at ${site} with ${label}, for ${item}.` };
    } catch (error) {
      if (error instanceof Error && error.message === BROWSER_CONTROL_REFUSAL) {
        return { ok: false, text: "The person is using this browser right now. Wait for them to hand it back, then call fill_card again." };
      }
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, text: `Could not fill the card: ${redactSecretsInText(reason)} ${PAY_YOURSELF}` };
    }
  }

  async function fill(card: CardValues, input: CardInput, amount: string, host: string, label: string, turn: Turn): Promise<Outcome> {
    if (!(await pageShowsAmount(amount, input))) {
      return { ok: false, text: `This page no longer shows the approved total ${amount}, so nothing was filled. If the total changed, call fill_card with the new total so the person can approve it.` };
    }
    const result = await fillCard(
      { number: card.number, expMonth: card.expMonth, expYear: card.expYear, ...(card.cvc ? { cvc: card.cvc } : {}), ...(card.holder ? { holder: card.holder } : {}), ...(card.postalCode ? { postalCode: card.postalCode } : {}) },
      { ...input, remember: deps.remember, turnActive: () => deps.turnActive?.(turn) !== false },
    );
    const stays = `The approval stays for one fill within ${PAYMENT_APPROVAL_MS / 60_000} minutes of the person's answer.`;
    if (!result.ok) {
      switch (result.reason) {
        case "turn-ended": return { ok: false, text: "Stopped filling the card because the turn ended." };
        case "prefilled": return { ok: false, text: `The card number field on ${host} already holds a card. If the checkout shows ${label}, press its pay button; otherwise clear that field and call fill_card again. ${stays}` };
        case "not-taken": return { ok: false, text: `The page on ${host} did not take the card number. Click the card number field once, then call fill_card again, or ${PAY_YOURSELF[0]!.toLowerCase()}${PAY_YOURSELF.slice(1)} ${stays}` };
        case "no-fields": return { ok: false, text: `No card number field found on ${host}. Open the checkout step that shows the card form (choose card as the payment method if the page asks), then call fill_card again. ${stays}` };
      }
    }
    const missing = result.missing.length
      ? ` The form also has ${words(result.missing)}, which ${card.cvc || !result.missing.includes("cvc") ? "did not fill" : "the saved card does not have"}: if the checkout needs it, ${PAY_YOURSELF[0]!.toLowerCase()}${PAY_YOURSELF.slice(1)}`
      : "";
    return {
      ok: true,
      held: { url: input.pageUrl() ?? "", ms: SECRET_HOLD_MS },
      text: `Filled the ${words(result.filled)} of ${label} on ${host}.${missing} Now press the page's own pay or place-order button once (take a snapshot to find it), then check the order went through and tell the person. Screenshots of this page are refused while the card is on it. You never see the card: do not read it back from the page.`,
    };
  }

  return { fillCardForTurn };
}
