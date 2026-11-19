/**
 * Saved payment cards in the Vault. A bot pays with one only through
 * fill_card, after the person approves that payment on a card in chat; the
 * server types the card into the checkout and the bot never sees it. Clients
 * see a card as its name, brand, last four digits and expiry, never its
 * number or security code.
 */
import type { LoginBots } from "./logins.ts";

export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "diners" | "jcb" | "unionpay" | "other";

/** One saved card as Settings shows it. No route ever returns the number or the security code. */
export interface VaultCard {
  id: string;
  /** What the person called it, such as Personal Visa. */
  name: string;
  brand: CardBrand;
  last4: string;
  expMonth: number;
  /** Four digits. */
  expYear: number;
  holder?: string;
  postalCode?: string;
  hasCvc: boolean;
  bots: LoginBots;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export const CARD_NAME_MAX = 80;
export const CARD_HOLDER_MAX = 120;
export const CARD_POSTAL_MAX = 16;
export const PAYMENT_AMOUNT_MAX = 40;
export const PAYMENT_ITEM_MAX = 160;

const BRAND_NAMES: Record<CardBrand, string> = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay", other: "Card",
};

export function cardDigits(raw: string): string {
  return raw.replace(/[\s-]/gu, "");
}

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

/** A card number as typed: 12 to 19 digits, spaces and dashes allowed, passing the Luhn check. */
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

export function validCvc(raw: string, brand: CardBrand): boolean {
  return brand === "amex" ? /^\d{4}$/u.test(raw) : /^\d{3,4}$/u.test(raw);
}

/** A two- or four-digit year as four digits; null for anything else. */
export function fullExpYear(raw: number): number | null {
  if (!Number.isInteger(raw)) return null;
  if (raw >= 0 && raw < 100) return 2000 + raw;
  return raw >= 2000 && raw < 2100 ? raw : null;
}

/** Past the last day of its expiry month. */
export function cardExpired(card: { expMonth: number; expYear: number }, now: number): boolean {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  return card.expYear < year || (card.expYear === year && card.expMonth < date.getUTCMonth() + 1);
}

/** A card as a bot or the approval card names it, such as Personal Visa (Visa ••4242). */
export function cardLabel(card: { name: string; brand: CardBrand; last4: string }): string {
  const brand = BRAND_NAMES[card.brand];
  return card.name && card.name !== brand ? `${card.name} (${brand} ••${card.last4})` : `${brand} ••${card.last4}`;
}

/**
 * The number in a total as a bot read it off a checkout, such as "$1,042.10"
 * or "1.042,10 €": its digits with two decimals, or null when it has none or
 * is not plainly one amount.
 */
export function amountValue(raw: string): string | null {
  const text = raw.trim();
  const found = text.match(/\d[\d.,\s  ']*/gu);
  if (!found || found.length !== 1) return null;
  const number = found[0]!.replace(/[\s  ']/gu, "").replace(/[.,]$/u, "");
  const decimal = /[.,](\d{1,2})$/u.exec(number);
  const whole = (decimal ? number.slice(0, -decimal[0].length) : number).replace(/[.,]/gu, "");
  if (!/^\d{1,9}$/u.test(whole)) return null;
  const cents = decimal ? decimal[1]!.padEnd(2, "0") : "00";
  return `${Number(whole)}.${cents}`;
}
