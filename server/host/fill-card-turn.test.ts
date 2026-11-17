import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PAYMENT_APPROVAL_MS } from "../../shared/payment-request.ts";
import type { OptionCardData } from "../../shared/wire.ts";
import type { StepContext } from "../browser-steps.ts";
import type { BotRecord } from "../store.ts";
import { VaultStore } from "../vault-store.ts";
import { createFillCardTurn, type FillCardTurnDeps } from "./fill-card-turn.ts";
import { PaymentRequestService } from "./payment-requests.ts";

// Obvious fakes only: Stripe's published test card.
const VISA = "4242424242424242";
const TURN = { botId: "pepper", threadId: "t1", generation: "g1" };
const BOT = { id: "pepper", name: "Pepper", color: "blue", browser: true, computer: "browser" } as unknown as BotRecord;

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "omb-fill-card-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A checkout page: its words, and one card number box the server can type into. */
function checkout(url: string, text: string) {
  const typed: string[] = [];
  const page = {
    url, text, typed,
    input: {
      pageUrl: () => page.url,
      frames: () => [{ id: "main", url: page.url, main: true }],
      read: async (_frame: string, script: string) => {
        if (script.includes("forms.some")) {
          const forms = JSON.parse(script.slice(script.lastIndexOf("(") + 1, -1)) as string[];
          const flat = page.text.replace(/[\s ']/gu, "");
          return JSON.stringify({ shown: forms.some((form) => new RegExp(`(?<![\\d.,])${form.replace(/[.]/gu, "\\.")}(?![\\d]|[.,]\\d)`, "u").test(flat)) });
        }
        if (script.includes("labelOf")) return JSON.stringify({ fields: [{ kind: "number", select: false, filled: false, maxLength: 0, fourDigitYear: false, twoDigitYear: false }] });
        if (script.includes("const out = {}")) return JSON.stringify({ number: typed.length > 0 });
        return "{}";
      },
      type: async (_frame: string, _selector: string, value: string) => { typed.push(value); },
    },
  };
  return page;
}

function setup(options: { engine?: "new" | "old" } = {}) {
  let clock = 1_000_000;
  const vault = new VaultStore({ dataDir: dir, now: () => clock });
  const card = vault.saveCard({ name: "Personal", number: VISA, expMonth: 4, expYear: 2031, cvc: "314", bots: ["pepper"] });
  const lines: Array<{ id: string; card?: OptionCardData }> = [];
  const answered: string[] = [];
  const payments = new PaymentRequestService({
    store: {
      messagesFor: () => lines,
      appendMessage: (_thread, message) => { const line = { id: `m${lines.length + 1}`, card: message.card }; lines.push(line); return line; },
      patchMessage: (_thread, id, patch) => { const line = lines.find((one) => one.id === id)!; line.card = patch.card; },
    },
    vault, remember: (value) => { remembered.push(value); },
    answer: (_thread, _message, text) => { answered.push(text); return true; },
    decide: () => {},
    now: () => clock,
  });
  const remembered: string[] = [];
  const page = checkout("https://shop.example.com/checkout", "Order total $42.10 Pay now");
  const deps: FillCardTurnDeps = {
    place: () => "browser", current: (bot) => bot, builtInBrowserOn: () => true,
    target: async () => ({ session: "s1", spec: { command: "chrome", env: {} }, env: {} }),
    cardInput: () => (options.engine === "old" ? null : page.input),
    claim: () => true,
    withSecretInput: vi.fn(async (_session, _spec, fill) => fill()),
    cards: vault, payments, from: () => undefined,
    remember: (value) => { remembered.push(value); },
    stepContext: () => ({}) as StepContext,
    now: () => clock,
  };
  const { fillCardForTurn } = createFillCardTurn(deps);
  const pay = (amount = "$42.10", extra: { card?: string } = {}) => fillCardForTurn(BOT, TURN, { amount, item: "2 concert tickets", ...extra });
  const respond = (behavior: "allow" | "deny", ownerReview = true) => payments.respond({ botId: "pepper", threadId: "t1", requestId: lines.at(-1)!.card!.requestId!, behavior }, ownerReview);
  const provide = (body: Record<string, unknown>, ownerReview = true) => payments.provideCard({ botId: "pepper", threadId: "t1", requestId: lines.at(-1)!.card!.requestId!, body }, ownerReview);
  return { vault, card, lines, answered, page, pay, respond, provide, remembered, deps, tick: (ms: number) => { clock += ms; } };
}

describe("fill_card", () => {
  it("first shows the person a Pay card with the total, the site and the card, and types nothing", async () => {
    const { pay, lines, page } = setup();
    const outcome = await pay();
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain("End this turn now");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.card).toMatchObject({
      title: "Pay $42.10 at example.com?", subtitle: "2 concert tickets · Personal (Visa ••4242)", options: ["Pay", "Cancel"], fixedOptions: true,
      paymentRequest: { botId: "pepper", threadId: "t1", site: "example.com", amount: "$42.10", cardLabel: "Personal (Visa ••4242)" },
    });
    expect(JSON.stringify(lines)).not.toContain(VISA);
    expect(page.typed).toEqual([]);
  });

  it("after the person approves, types the card once, and a second fill needs a new approval", async () => {
    const { pay, respond, answered, page, vault, card, remembered, lines } = setup();
    await pay();
    expect(respond("allow")).toMatchObject({ status: 200, body: { outcome: "allowed-once" } });
    expect(answered[0]).toContain("The person approved paying $42.10 at example.com with Personal (Visa ••4242)");
    const filled = await pay();
    expect(filled).toMatchObject({ ok: true });
    expect(filled.text).toContain("Filled the card number of Personal (Visa ••4242) on shop.example.com");
    expect(filled.text).not.toContain(VISA);
    expect(page.typed).toEqual([VISA]);
    expect(remembered).toContain(VISA);
    expect(lines[0]!.card!.paymentRequest!.usedAt).toBeDefined();
    expect(vault.listCards().find((one) => one.id === card.id)!.lastUsedAt).toBeDefined();
    const again = await pay();
    expect(again.text).toContain("End this turn now");
    expect(page.typed).toEqual([VISA]);
  });

  it("asks again when the total changed, and fills nothing once the page stops showing the approved total", async () => {
    const { pay, respond, page, lines } = setup();
    await pay();
    respond("allow");
    page.text = "Order total $99.00";
    expect((await pay("$99.00")).text).toContain("End this turn now");
    expect(lines.at(-1)!.card!.paymentRequest!.amount).toBe("$99.00");
    expect((await pay("$42.10")).text).toContain("no longer shows the approved total $42.10");
    expect(page.typed).toEqual([]);
  });

  it("refuses a total the page does not show, a declined or stale approval, and a request off the new browser", async () => {
    const declined = setup();
    expect((await declined.pay("$4.21")).text).toContain("does not appear on this page");
    await declined.pay();
    declined.respond("deny");
    expect(declined.answered[0]).toContain("The person declined paying $42.10");
    expect((await declined.pay()).text).toContain("End this turn now");
    expect(declined.page.typed).toEqual([]);

    const stale = setup();
    await stale.pay();
    stale.respond("allow");
    stale.tick(PAYMENT_APPROVAL_MS + 1);
    expect((await stale.pay()).text).toContain("End this turn now");
    expect(stale.page.typed).toEqual([]);

    const old = setup({ engine: "old" });
    expect((await old.pay()).text).toContain("needs the new browser");
    expect(old.lines).toEqual([]);
  });

  it("needs the desktop app or an admin to approve, and an http page never gets a card", async () => {
    const { pay, respond, page, lines } = setup();
    await pay();
    expect(respond("allow", false)).toMatchObject({ status: 403 });
    expect(lines[0]!.card!.answered).toBeUndefined();
    page.url = "http://shop.example.com/checkout";
    expect((await pay()).text).toContain("is not secure");
  });

  it("asks which card when the bot may use more than one", async () => {
    const { pay, vault } = setup();
    vault.saveCard({ name: "Work", number: "5555555555554444", expMonth: 4, expYear: 2031, bots: "all" });
    expect((await pay()).text).toContain("There are 2 saved cards you may use");
    expect((await pay("$42.10", { card: "4444" })).text).toContain("End this turn now");
  });

  it("with no card it may use, asks the person to add one on a secure card, which a phone's Pay cannot answer", async () => {
    const { pay, vault, card, lines, respond, page } = setup();
    vault.updateCard(card.id, { bots: ["quill"] });
    const asked = await pay();
    expect(asked.text).toContain("add a card to pay $42.10 at example.com");
    expect(lines[0]!.card).toMatchObject({ title: "Add a card to pay $42.10 at example.com", subtitle: "2 concert tickets", options: ["Add card", "Cancel"], paymentRequest: { needsCard: true, cardId: "" } });
    expect(respond("allow")).toMatchObject({ status: 409 });
    expect(page.typed).toEqual([]);
  });

  it("fills a card the person added only for this payment once, and never keeps it", async () => {
    const { pay, vault, card, provide, answered, page, remembered, lines } = setup();
    vault.removeCard(card.id);
    await pay();
    expect(provide({ number: "5555 5555 5555 4444", expMonth: 9, expYear: 32, cvc: "123" }, false)).toMatchObject({ status: 403 });
    expect(provide({ number: "5555555555554441", expMonth: 9, expYear: 32 })).toMatchObject({ status: 400 });
    expect(provide({ number: "5555 5555 5555 4444", expMonth: 9, expYear: 32, cvc: "123" })).toMatchObject({ status: 200, body: { outcome: "allowed-once" } });
    expect(answered[0]).toContain("The person added Mastercard ••4444 for this payment only");
    expect(JSON.stringify(lines)).not.toContain("5555555555554444");
    expect(remembered).toContain("5555555555554444");
    expect(vault.listCards()).toEqual([]);
    expect((await pay()).text).toContain("Filled the card number of Mastercard ••4444");
    expect(page.typed).toEqual(["5555555555554444"]);
    expect((await pay()).text).toContain("add a card to pay");
  });

  it("saves a card the person added with Save to the Vault, for the asking bot, and pays with it at once", async () => {
    const { pay, vault, card, provide, answered, page } = setup();
    vault.removeCard(card.id);
    await pay();
    provide({ number: "5555555555554444", expMonth: 9, expYear: 2032, holder: "Ada", save: true });
    expect(vault.listCards()).toMatchObject([{ last4: "4444", bots: ["pepper"], holder: "Ada" }]);
    expect(answered[0]).toContain("saved it to the Vault for later");
    await pay();
    expect(page.typed).toEqual(["5555555555554444"]);
    expect(vault.listCards()[0]!.lastUsedAt).toBeDefined();
  });

  it("asks for a new card when the bot says new, even with one saved", async () => {
    const { pay, lines } = setup();
    await pay("$42.10", { card: "new" });
    expect(lines[0]!.card!.paymentRequest).toMatchObject({ needsCard: true });
  });
});
