/**
 * A saved payment card as a phone reads and adds it: GET /api/vault's `cards` and POST /api/vault/cards, which the
 * server checks with shared/payment-cards.ts. No route returns a card's number or security code. A bot pays with a card
 * only through fill_card, after the person approves that payment.
 */

export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "diners" | "jcb" | "unionpay" | "other";

/** Which bots may use it: every bot, or the ones named. */
export type CardBots = "all" | string[];

/** One saved card as the Vault lists it. */
export interface VaultCard {
  id: string;
  /** What the person called it, such as Personal Visa; may be empty. */
  name: string;
  brand: CardBrand;
  last4: string;
  expMonth: number;
  /** Four digits. */
  expYear: number;
  holder?: string;
  postalCode?: string;
  hasCvc: boolean;
  bots: CardBots;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

/** The body of POST /api/vault/cards. */
export interface NewCardInput {
  name: string;
  number: string;
  expMonth: number;
  expYear: number;
  cvc?: string;
  holder?: string;
  postalCode?: string;
  bots: CardBots;
}

export const CARD_NAME_MAX = 80;
export const CARD_HOLDER_MAX = 120;
export const CARD_POSTAL_MAX = 16;

export const BRAND_NAMES: Record<CardBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  other: "Card",
};

export function cardDigits(raw: string): string {
  return raw.replace(/[\s-]/gu, "");
}

export function validCardNumber(raw: string): boolean {
  const digits = cardDigits(raw);
  if (!/^\d{12,19}$/u.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** The brand its leading digits name, as the server reads it. */
export function cardBrand(number: string): CardBrand {
  const digits = cardDigits(number);
  if (digits.startsWith("4")) return "visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/u.test(digits)) return "mastercard";
  if (/^3[47]/u.test(digits)) return "amex";
  if (/^(6011|65|64[4-9])/u.test(digits)) return "discover";
  if (/^3(0[0-5]|[689])/u.test(digits)) return "diners";
  if (/^35(2[89]|[3-8])/u.test(digits)) return "jcb";
  if (digits.startsWith("62")) return "unionpay";
  return "other";
}

/** "1234 5678 9012 3456", or "3782 822463 10005" for American Express, as the person types it. */
export function groupCardNumber(raw: string): string {
  const digits = raw.replace(/\D/gu, "").slice(0, 19);
  const groups = cardBrand(digits) === "amex" ? [4, 6, 5] : [4, 4, 4, 4, 3];
  const parts: string[] = [];
  let at = 0;
  for (const length of groups) {
    if (at >= digits.length) break;
    parts.push(digits.slice(at, at + length));
    at += length;
  }
  return parts.join(" ");
}

/** "MM/YY" while typing: the slash comes after the month. */
export function groupExpiry(raw: string): string {
  const digits = raw.replace(/\D/gu, "").slice(0, 6);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

export function parseExpiry(raw: string): { month: number; year: number } | null {
  const match = /^\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*$/u.exec(raw);
  if (!match) return null;
  const month = Number(match[1]);
  const year = match[2]!.length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  return month >= 1 && month <= 12 && year >= 2000 && year < 2100 ? { month, year } : null;
}

/** Past the last day of its expiry month. */
export function cardExpired(card: { expMonth: number; expYear: number }, now: Date): boolean {
  return card.expYear < now.getFullYear() || (card.expYear === now.getFullYear() && card.expMonth < now.getMonth() + 1);
}

export function expiryLabel(month: number, year: number): string {
  return `${String(month).padStart(2, "0")}/${String(year % 100).padStart(2, "0")}`;
}

/** A card as the Vault names it: its own name, or its brand and last four digits. */
export function cardTitle(card: { name: string; brand: CardBrand; last4: string }): string {
  return card.name.trim() || `${BRAND_NAMES[card.brand]} ending ${card.last4}`;
}

export const CARD_ERRORS = {
  number: "Enter the whole card number. That one doesn't look right: check its digits.",
  expiry: "Enter the expiry as MM/YY.",
  expired: "That card has expired.",
  cvc: "The security code is the 3 digits on the back of the card (4 on the front for American Express).",
  name: `Give the card a name of at most ${CARD_NAME_MAX} characters.`,
  holder: `The name on the card can be at most ${CARD_HOLDER_MAX} characters.`,
  postalCode: `The billing ZIP or postal code can be at most ${CARD_POSTAL_MAX} letters and digits.`,
} as const;

/** What the person typed, as POST /api/vault/cards takes it, or what to fix first. */
export function parseCard(
  input: { name: string; number: string; expiry: string; cvc: string; holder: string; postalCode: string; bots: CardBots },
  now: Date,
): { ok: true; card: NewCardInput } | { ok: false; field: keyof typeof CARD_ERRORS; error: string } {
  const fail = (field: keyof typeof CARD_ERRORS) => ({ ok: false as const, field, error: CARD_ERRORS[field] });
  if (!validCardNumber(input.number)) return fail("number");
  const expiry = parseExpiry(input.expiry);
  if (!expiry) return fail("expiry");
  if (cardExpired({ expMonth: expiry.month, expYear: expiry.year }, now)) return fail("expired");
  const cvc = input.cvc.trim();
  if (!(cardBrand(input.number) === "amex" ? /^\d{4}$/u : /^\d{3,4}$/u).test(cvc)) return fail("cvc");
  const name = input.name.trim();
  if (name.length > CARD_NAME_MAX) return fail("name");
  const holder = input.holder.trim();
  if (holder.length > CARD_HOLDER_MAX) return fail("holder");
  const postalCode = input.postalCode.trim();
  if (postalCode && (postalCode.length > CARD_POSTAL_MAX || !/^[\p{L}\p{N} -]+$/u.test(postalCode))) return fail("postalCode");
  return {
    ok: true,
    card: {
      name,
      number: cardDigits(input.number),
      expMonth: expiry.month,
      expYear: expiry.year,
      cvc,
      ...(holder ? { holder } : {}),
      ...(postalCode ? { postalCode } : {}),
      bots: input.bots,
    },
  };
}
