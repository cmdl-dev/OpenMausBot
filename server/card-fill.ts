// The bot never holds the card: page scripts carry no card value and answer booleans, values go in as real typing into
// the field (in a payment provider's iframe too), and the bot hears which fields were filled, never a value.
import { randomBytes } from "node:crypto";

import { amountValue } from "../shared/payment-cards.ts";

export interface CardFrame {
  id: string;
  url: string;
  main: boolean;
}

export interface CardFillDeps {
  frames(): CardFrame[];
  /** Runs a script in the frame's isolated world and returns its value. */
  read(frameId: string, script: string): Promise<unknown>;
  /** Types a saved value into the one element `selector` names in that frame, as real input. */
  type(frameId: string, selector: string, value: string): Promise<void>;
  remember(value: string, kind: "password" | "code"): void;
  turnActive?(): boolean;
}

export interface CardValues {
  number: string;
  expMonth: number;
  expYear: number;
  cvc?: string;
  holder?: string;
  postalCode?: string;
}

export type CardField = "number" | "exp" | "expMonth" | "expYear" | "cvc" | "name" | "postal";

export type CardFillOutcome =
  | { ok: true; filled: CardField[]; missing: CardField[] }
  | { ok: false; reason: "no-fields" | "prefilled" | "not-taken" | "turn-ended" };

const MARK = "data-omb-card";

// Shared by every page script: shadow roots, what a person could see, the label a field is known by.
const HELPERS = `
  const MARK = ${JSON.stringify(MARK)};
  const queryAllDeep = (root, selector) => {
    const found = Array.from(root.querySelectorAll(selector));
    for (const host of root.querySelectorAll("*")) if (host.shadowRoot) found.push(...queryAllDeep(host.shadowRoot, selector));
    return found;
  };
  const all = (selector) => queryAllDeep(document, selector);
  const hostOf = (el) => { const root = el.getRootNode ? el.getRootNode() : null; return root && root.host ? root.host : null; };
  const visible = (el) => {
    if (!(el instanceof Element) || !el.isConnected || el.getClientRects().length === 0) return false;
    for (let node = el; node; node = node.parentElement || hostOf(node)) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
    return true;
  };
`;

/** Marks one field per kind and describes each; in the page itself, only fields of the form that holds the card number. */
const FIND_FIELDS = `((nonce, main) => {
  ${HELPERS}
  const labelOf = (el) => {
    const words = [el.getAttribute("name"), el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label"),
      el.getAttribute("data-elements-stable-field-name"), el.getAttribute("data-fieldtype"), el.getAttribute("data-testid"), el.title];
    if (el.id) for (const label of document.querySelectorAll("label[for]")) if (label.htmlFor === el.id) words.push(label.textContent);
    const wrapping = el.closest && el.closest("label");
    if (wrapping) words.push(wrapping.textContent);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) for (const id of labelledBy.split(/\\s+/)) { const node = document.getElementById(id); if (node) words.push(node.textContent); }
    return words.filter(Boolean).join(" ").toLowerCase().replace(/\\s+/g, " ");
  };
  const kindOf = (el) => {
    const auto = (el.getAttribute("autocomplete") || "").toLowerCase().split(/\\s+/);
    if (auto.includes("cc-number")) return "number";
    if (auto.includes("cc-exp-month")) return "expMonth";
    if (auto.includes("cc-exp-year")) return "expYear";
    if (auto.includes("cc-exp")) return "exp";
    if (auto.includes("cc-csc")) return "cvc";
    if (auto.includes("cc-name")) return "name";
    if (auto.includes("postal-code") && (auto.includes("billing") || !main)) return "postal";
    const label = labelOf(el);
    if (!label) return null;
    if (/cvc|cvv|\\bcsc\\b|cvn|security.?code|card.?code|verification|securitycode/.test(label)) return "cvc";
    if (/name.?on.?card|card.?holder|holder.?name|cc.?name|nameoncard/.test(label)) return "name";
    if (/card.?num|cc.?num|credit.?card.?(no|num)|card.?no\\b|cardnumber|\\bpan\\b/.test(label)) return "number";
    if (/(exp\\w*|valid|card).{0,12}(month|\\bmm\\b)|cc.?month/.test(label)) return "expMonth";
    if (/(exp\\w*|valid|card).{0,12}(year|\\byy(yy)?\\b)|cc.?year/.test(label)) return "expYear";
    if (/expir|exp.?date|\\bexp\\b|mm\\s*\\/\\s*(yy|aa)|valid.?thru|expirydate/.test(label)) return "exp";
    if (!main && /zip|postal|post.?code/.test(label)) return "postal";
    return null;
  };
  const usable = (el) => {
    if (!visible(el) || el.disabled || el.readOnly) return false;
    if (el instanceof HTMLSelectElement) return true;
    if (!(el instanceof HTMLInputElement)) return false;
    return ["", "text", "tel", "number", "password", "search"].includes((el.getAttribute("type") || "").toLowerCase());
  };
  for (const el of all("[" + MARK + "]")) el.removeAttribute(MARK);
  const found = {};
  for (const el of all("input, select")) {
    if (!usable(el)) continue;
    const kind = kindOf(el);
    if (!kind || found[kind]) continue;
    if (kind === "number" && el instanceof HTMLSelectElement) continue;
    if (el.type === "password" && kind !== "cvc") continue;
    found[kind] = el;
  }
  if (main) {
    const number = found.number;
    const form = number ? (number.form || number.closest("form")) : null;
    for (const kind of Object.keys(found)) {
      if (kind === "number") continue;
      const el = found[kind];
      if (!number || (form && (el.form || el.closest("form")) !== form)) delete found[kind];
    }
  }
  const fields = [];
  for (const [kind, el] of Object.entries(found)) {
    el.setAttribute(MARK, nonce + ":" + kind);
    fields.push({
      kind, select: el instanceof HTMLSelectElement, filled: !(el instanceof HTMLSelectElement) && typeof el.value === "string" && el.value.trim().length > 0,
      maxLength: el instanceof HTMLInputElement && el.maxLength > 0 ? el.maxLength : 0,
      fourDigitYear: /yyyy|aaaa|jjjj/i.test(el.getAttribute("placeholder") || ""),
      twoDigitYear: /^(yy|aa|jj)$/i.test((el.getAttribute("placeholder") || "").trim()),
    });
  }
  return JSON.stringify({ fields });
})`;

/** Picks the option that names one of `wanted`, as a person choosing it would. */
const PICK_OPTION = `((nonce, kind, wanted) => {
  ${HELPERS}
  const el = all("[" + MARK + "=\\"" + nonce + ":" + kind + "\\"]")[0];
  if (!(el instanceof HTMLSelectElement)) return JSON.stringify({ picked: false });
  const want = wanted.map((word) => String(word).toLowerCase());
  const index = Array.from(el.options).findIndex((option) => want.includes(option.value.trim().toLowerCase()) || want.includes(option.text.trim().toLowerCase()));
  if (index < 0) return JSON.stringify({ picked: false });
  el.focus();
  el.selectedIndex = index;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return JSON.stringify({ picked: true });
})`;

const CHECK_FIELDS = `((nonce) => {
  ${HELPERS}
  const out = {};
  for (const el of all("[" + MARK + "]")) {
    const mark = el.getAttribute(MARK) || "";
    if (!mark.startsWith(nonce + ":")) continue;
    out[mark.slice(nonce.length + 1)] = el instanceof HTMLSelectElement ? el.selectedIndex > 0 || el.value !== "" : typeof el.value === "string" && el.value.trim().length > 0;
  }
  return JSON.stringify(out);
})`;

const UNMARK = `((nonce) => {
  ${HELPERS}
  for (const el of all("[" + MARK + "]")) if ((el.getAttribute(MARK) || "").startsWith(nonce + ":")) el.removeAttribute(MARK);
  return "{}";
})`;

/** Whether the page's own words show this total, written any way a shop writes it. */
const SHOWS_AMOUNT = `((forms) => {
  const text = (document.body ? document.body.innerText : "").replace(/[\\s\\u00a0\\u202f']/g, "");
  const shown = forms.some((form) => {
    const escaped = form.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");
    return new RegExp("(?<![\\\\d.,])" + escaped + "(?![\\\\d]|[.,]\\\\d)").test(text);
  });
  return JSON.stringify({ shown });
})`;

function call(script: string, ...args: unknown[]): string {
  return `${script}(${args.map((arg) => JSON.stringify(arg ?? null)).join(", ")})`;
}

function parsed(value: unknown): Record<string, unknown> | null {
  let out = value;
  for (let depth = 0; depth < 2 && typeof out === "string"; depth++) {
    try { out = JSON.parse(out); } catch { return null; }
  }
  return out && typeof out === "object" && !Array.isArray(out) ? out as Record<string, unknown> : null;
}

/** "42.10" as a page may write it: 42.10, 42,10, and for a whole amount 42 too, with or without thousands separators. */
export function amountForms(value: string): string[] {
  const [whole, cents] = value.split(".") as [string, string];
  const grouped = (sep: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/gu, sep);
  const wholes = [...new Set([whole, grouped(","), grouped("."), grouped("")])];
  const forms = new Set<string>();
  for (const w of wholes) {
    for (const dec of [".", ","]) if (!w.includes(dec)) forms.add(`${w}${dec}${cents}`);
    if (cents === "00") forms.add(w);
  }
  return [...forms];
}

/** Whether the total the bot names appears on the page (in any frame). False when it is not plainly one amount. */
export async function pageShowsAmount(amount: string, deps: Pick<CardFillDeps, "frames" | "read">): Promise<boolean> {
  const value = amountValue(amount);
  if (!value) return false;
  const forms = amountForms(value);
  for (const frame of deps.frames()) {
    const answer = parsed(await deps.read(frame.id, call(SHOWS_AMOUNT, forms)).catch(() => null));
    if (answer?.shown === true) return true;
  }
  return false;
}

interface Found {
  kind: CardField;
  select: boolean;
  filled: boolean;
  maxLength: number;
  fourDigitYear: boolean;
  twoDigitYear: boolean;
}

function foundFields(value: Record<string, unknown> | null): Found[] {
  const fields = Array.isArray(value?.fields) ? value.fields as unknown[] : [];
  return fields.flatMap((raw) => {
    const field = raw as Record<string, unknown>;
    const kind = field.kind;
    if (typeof kind !== "string" || !FIELD_ORDER.includes(kind as CardField)) return [];
    return [{ kind: kind as CardField, select: field.select === true, filled: field.filled === true, maxLength: typeof field.maxLength === "number" ? field.maxLength : 0,
      fourDigitYear: field.fourDigitYear === true, twoDigitYear: field.twoDigitYear === true }];
  });
}

const FIELD_ORDER: CardField[] = ["number", "exp", "expMonth", "expYear", "cvc", "name", "postal"];

const pad = (n: number) => String(n).padStart(2, "0");

/** What goes into a typed field of this kind. */
function typedValue(field: Found, card: CardValues): string | null {
  const yy = pad(card.expYear % 100);
  switch (field.kind) {
    case "number": return card.number;
    case "exp": return field.fourDigitYear || field.maxLength >= 7 ? `${pad(card.expMonth)}/${card.expYear}` : field.maxLength === 4 ? `${pad(card.expMonth)}${yy}` : `${pad(card.expMonth)}/${yy}`;
    case "expMonth": return pad(card.expMonth);
    case "expYear": return field.maxLength === 2 || field.twoDigitYear ? yy : String(card.expYear);
    case "cvc": return card.cvc ?? null;
    case "name": return card.holder ?? null;
    case "postal": return card.postalCode ?? null;
  }
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** The words an option for this month or year may carry. */
function optionWords(kind: "expMonth" | "expYear", card: CardValues): string[] {
  if (kind === "expYear") return [String(card.expYear), pad(card.expYear % 100)];
  const name = MONTHS[card.expMonth - 1]!;
  return [String(card.expMonth), pad(card.expMonth), name, name.slice(0, 3), `${pad(card.expMonth)} - ${name}`];
}

/**
 * Fills the card into the checkout open in the browser: the page itself and every frame in it. Values are typed only into
 * fields that are empty and named as card fields; in the page itself, only into the form that holds the card number.
 */
export async function fillCard(card: CardValues, deps: CardFillDeps): Promise<CardFillOutcome> {
  const nonce = randomBytes(12).toString("hex");
  const active = () => deps.turnActive?.() !== false;
  const frames = deps.frames();
  const plan: Array<{ frame: CardFrame; field: Found }> = [];
  try {
    for (const frame of frames) {
      if (!active()) return { ok: false, reason: "turn-ended" };
      for (const field of foundFields(parsed(await deps.read(frame.id, call(FIND_FIELDS, nonce, frame.main)).catch(() => null)))) {
        if (!plan.some((planned) => planned.field.kind === field.kind)) plan.push({ frame, field });
      }
    }
    const number = plan.find((planned) => planned.field.kind === "number");
    if (!number) return { ok: false, reason: "no-fields" };
    if (number.field.filled) return { ok: false, reason: "prefilled" };
    deps.remember(card.number, "password");
    if (card.cvc) deps.remember(card.cvc, "code");
    const ordered = [...plan].sort((a, b) => FIELD_ORDER.indexOf(a.field.kind) - FIELD_ORDER.indexOf(b.field.kind));
    for (const { frame, field } of ordered) {
      if (!active()) return { ok: false, reason: "turn-ended" };
      if (field.filled) continue;
      if (field.select) {
        if (field.kind === "expMonth" || field.kind === "expYear") await deps.read(frame.id, call(PICK_OPTION, nonce, field.kind, optionWords(field.kind, card))).catch(() => null);
        continue;
      }
      const value = typedValue(field, card);
      if (value === null) continue;
      await deps.type(frame.id, `[${MARK}="${nonce}:${field.kind}"]`, value).catch(() => undefined);
    }
    const held = new Set<string>();
    for (const frame of new Set(plan.map((planned) => planned.frame))) {
      const checked = parsed(await deps.read(frame.id, call(CHECK_FIELDS, nonce)).catch(() => null)) ?? {};
      for (const [kind, ok] of Object.entries(checked)) if (ok === true) held.add(kind);
    }
    if (!held.has("number")) return { ok: false, reason: "not-taken" };
    const kinds = ordered.filter((planned) => !planned.field.filled).map((planned) => planned.field.kind);
    return { ok: true, filled: kinds.filter((kind) => held.has(kind)), missing: kinds.filter((kind) => !held.has(kind)) };
  } finally {
    for (const frame of new Set(plan.map((planned) => planned.frame))) await deps.read(frame.id, call(UNMARK, nonce)).catch(() => null);
  }
}
