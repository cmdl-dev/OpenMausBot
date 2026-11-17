// No answer ever carries a card's number or security code: they are only ever replaced.
import {
  CARD_HOLDER_MAX, CARD_NAME_MAX, CARD_POSTAL_MAX, cardBrand, cardDigits, fullExpYear, validCardNumber, validCvc, type CardBrand,
} from "../../shared/payment-cards.ts";
import type { LoginBots } from "../../shared/logins.ts";
import type { CardPatch, NewCard } from "../vault-store.ts";

export const CARD_ERRORS = {
  name: `Give the card a name of at most ${CARD_NAME_MAX} characters.`,
  number: "Enter the whole card number: 12 to 19 digits that pass the card number check.",
  expiry: "Enter the expiry month (1 to 12) and year.",
  cvc: "The security code is the 3 digits on the back of the card (4 on the front for American Express).",
  holder: `The name on the card can be at most ${CARD_HOLDER_MAX} characters.`,
  postalCode: `The billing ZIP or postal code can be at most ${CARD_POSTAL_MAX} letters and digits.`,
} as const;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function plainText(raw: string): string {
  return [...raw].map((ch) => (ch.charCodeAt(0) < 0x20 || ch === "\u007f" ? " " : ch)).join("").replace(/\s+/gu, " ").trim();
}

/** Undefined leaves it; for an optional field, null or "" clears it. */
function optionalText(raw: unknown, max: number, pattern: RegExp | null, error: string): Parsed<string | null | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error };
  const text = plainText(raw);
  if (!text) return { ok: true, value: null };
  return text.length <= max && (!pattern || pattern.test(text)) ? { ok: true, value: text } : { ok: false, error };
}

function expiry(month: unknown, year: unknown): Parsed<{ expMonth: number; expYear: number }> {
  const m = typeof month === "string" ? Number(month) : month;
  const y = typeof year === "string" ? Number(year) : year;
  const fullYear = typeof y === "number" ? fullExpYear(y) : null;
  if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 12 || fullYear === null) return { ok: false, error: CARD_ERRORS.expiry };
  return { ok: true, value: { expMonth: m, expYear: fullYear } };
}

/** A card's fields from a request. `saved`: the card a change is to, whose brand checks a new security code and whose
 * expiry fills the half of one a change leaves out. */
export function parseCardFields(body: Record<string, unknown>, options: { creating: boolean; saved?: { brand: CardBrand; expMonth: number; expYear: number } }): Parsed<Omit<CardPatch, "bots">> {
  const out: Omit<CardPatch, "bots"> = {};
  if (body.name !== undefined || options.creating) {
    const name = typeof body.name === "string" ? plainText(body.name) : body.name === undefined ? "" : null;
    if (name === null || name.length > CARD_NAME_MAX) return { ok: false, error: CARD_ERRORS.name };
    out.name = name;
  }
  if (body.number !== undefined || options.creating) {
    if (typeof body.number !== "string" || !validCardNumber(body.number)) return { ok: false, error: CARD_ERRORS.number };
    out.number = cardDigits(body.number);
  }
  if (body.expMonth !== undefined || body.expYear !== undefined || options.creating) {
    const parsed = expiry(body.expMonth ?? options.saved?.expMonth, body.expYear ?? options.saved?.expYear);
    if (!parsed.ok) return parsed;
    Object.assign(out, parsed.value);
  }
  const brand = out.number ? cardBrand(out.number) : options.saved?.brand ?? "other";
  const cvc = optionalText(body.cvc, 4, null, CARD_ERRORS.cvc);
  if (!cvc.ok) return cvc;
  if (cvc.value && !validCvc(cvc.value, brand)) return { ok: false, error: CARD_ERRORS.cvc };
  if (cvc.value !== undefined) out.cvc = cvc.value;
  const holder = optionalText(body.holder, CARD_HOLDER_MAX, null, CARD_ERRORS.holder);
  if (!holder.ok) return holder;
  if (holder.value !== undefined) out.holder = holder.value;
  const postalCode = optionalText(body.postalCode, CARD_POSTAL_MAX, /^[\p{L}\p{N} -]+$/u, CARD_ERRORS.postalCode);
  if (!postalCode.ok) return postalCode;
  if (postalCode.value !== undefined) out.postalCode = postalCode.value;
  return { ok: true, value: out };
}

export function newCard(fields: Omit<CardPatch, "bots">, bots: LoginBots): NewCard {
  return {
    name: fields.name ?? "", number: fields.number!, expMonth: fields.expMonth!, expYear: fields.expYear!, bots,
    ...(fields.cvc ? { cvc: fields.cvc } : {}), ...(fields.holder ? { holder: fields.holder } : {}), ...(fields.postalCode ? { postalCode: fields.postalCode } : {}),
  };
}
