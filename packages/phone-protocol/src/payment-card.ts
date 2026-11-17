/**
 * Payment cards in the Vault. A card is kept encrypted on the computer like a saved secret, and a bot asks for each part
 * by name ("<card name> number", "<card name> expiry" …) as it asks for a saved secret. Clients see a card as its name,
 * brand, last four digits and expiry: no route returns its number or security code.
 */

/** Which bots may use it: every bot, or the ones named (the same choice a saved login takes). */
export type CardBots = "all" | string[];

export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "diners" | "jcb" | "unionpay" | "card";

/** One saved card as the Vault lists it. */
export interface VaultCard {
  id: string;
  /** What the person called it, such as "Work Amex"; by default its brand and last four digits. */
  name: string;
  brand: CardBrand;
  last4: string;
  expMonth: number;
  /** Four digits. */
  expYear: number;
  bots: CardBots;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

/** A card as a client sends it to POST /api/vault/cards. */
export interface NewCardInput {
  name?: string;
  number: string;
  /** MM/YY or MM/YYYY. */
  expiry: string;
  securityCode: string;
  nameOnCard?: string;
  postalCode?: string;
  bots?: CardBots;
}

export const CARD_NAME_MAX = 60;
export const CARD_TEXT_MAX = 80;

/** The parts of a card a bot may ask for, each as "<card name> <part>". */
export const CARD_PARTS = ["number", "expiry", "security code", "name on card", "billing postal code"] as const;
export type CardPart = (typeof CARD_PARTS)[number];

export const BRAND_NAMES: Record<CardBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  card: "Card",
};

export function cardDigits(raw: string): string {
  return raw.replace(/[\s-]/gu, "");
}

export function luhnValid(digits: string): boolean {
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

/** The brand its leading digits name (the issuer ranges networks publish). */
export function cardBrand(digits: string): CardBrand {
  const first2 = Number(digits.slice(0, 2));
  const first4 = Number(digits.slice(0, 4));
  if (digits.startsWith("4")) return "visa";
  if ((first2 >= 51 && first2 <= 55) || (first4 >= 2221 && first4 <= 2720)) return "mastercard";
  if (first2 === 34 || first2 === 37) return "amex";
  if (/^(?:6011|65|64[4-9])/u.test(digits)) return "discover";
  if (/^(?:30[0-5]|36|38|39)/u.test(digits)) return "diners";
  if (first4 >= 3528 && first4 <= 3589) return "jcb";
  if (digits.startsWith("62")) return "unionpay";
  return "card";
}

/** "1234 5678 9012 3456", or "3782 822463 10005" for American Express, as the person types it. */
export function groupCardNumber(raw: string): string {
  const digits = cardDigits(raw).replace(/\D/gu, "").slice(0, 19);
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
  return month >= 1 && month <= 12 ? { month, year } : null;
}

/** A card is good through the last day of its expiry month. */
export function cardExpired(month: number, year: number, now: Date): boolean {
  return year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
}

export function expiryLabel(month: number, year: number): string {
  return `${String(month).padStart(2, "0")}/${String(year % 100).padStart(2, "0")}`;
}

export function defaultCardName(brand: CardBrand, last4: string): string {
  return `${BRAND_NAMES[brand]} ending ${last4}`;
}

export const CARD_ERRORS = {
  number: "Enter the card number. That one doesn't look right: check its digits.",
  expiry: "Enter the expiry as MM/YY.",
  expired: "That card has expired.",
  securityCode: "Enter the 3 or 4 digit security code from the card.",
  name: `Give the card a name of at most ${CARD_NAME_MAX} characters.`,
  text: `Keep the name on the card and postal code to ${CARD_TEXT_MAX} characters.`,
} as const;

export interface ParsedCard {
  name: string;
  number: string;
  brand: CardBrand;
  expMonth: number;
  expYear: number;
  securityCode: string;
  nameOnCard?: string;
  postalCode?: string;
}

function plainText(raw: unknown): string {
  return typeof raw === "string" ? [...raw].map((ch) => (ch.charCodeAt(0) < 0x20 || ch === "\u007f" ? " " : ch)).join("").trim() : "";
}

/** A card the person typed, checked as the server checks it, so a form can say what is wrong before it is sent. */
export function parseCard(input: Partial<Record<keyof NewCardInput, unknown>>, now: Date): { ok: true; card: ParsedCard } | { ok: false; field: keyof typeof CARD_ERRORS; error: string } {
  const fail = (field: keyof typeof CARD_ERRORS) => ({ ok: false as const, field, error: CARD_ERRORS[field] });
  const number = typeof input.number === "string" ? cardDigits(input.number) : "";
  if (!luhnValid(number)) return fail("number");
  const expiry = typeof input.expiry === "string" ? parseExpiry(input.expiry) : null;
  if (!expiry) return fail("expiry");
  if (cardExpired(expiry.month, expiry.year, now)) return fail("expired");
  const brand = cardBrand(number);
  const securityCode = typeof input.securityCode === "string" ? input.securityCode.trim() : "";
  if (!(brand === "amex" ? /^\d{4}$/u : /^\d{3,4}$/u).test(securityCode)) return fail("securityCode");
  const name = plainText(input.name) || defaultCardName(brand, number.slice(-4));
  if (name.length > CARD_NAME_MAX) return fail("name");
  const nameOnCard = plainText(input.nameOnCard);
  const postalCode = plainText(input.postalCode);
  if (nameOnCard.length > CARD_TEXT_MAX || postalCode.length > CARD_TEXT_MAX) return fail("text");
  return {
    ok: true,
    card: { name, number, brand, expMonth: expiry.month, expYear: expiry.year, securityCode, ...(nameOnCard ? { nameOnCard } : {}), ...(postalCode ? { postalCode } : {}) },
  };
}
