// What a browser tool's answer may say: a page's address without its secrets, how the page's text changed, and no secret
// the bot holds.

/** ~8k tokens: a heavy encyclopedia article's interactive snapshot (21k chars) fits; a whole product page as markdown (79k) does not. */
export const DEFAULT_BROWSER_RESULT_BUDGET = 32_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** agent_browser_read reads the open tab only; a `url` argument is answered with the way to read another address. */
const READ_TOOL = "agent_browser_read";
export const READ_OPEN_PAGE_ONLY = "agent_browser_read reads the page open in this browser. Open the address with agent_browser_open first, then call agent_browser_read without url.";
export function readsAroundBrowser(params: unknown): boolean {
  return isRecord(params) && params.name === READ_TOOL && isRecord(params.arguments) && params.arguments.url !== undefined;
}

export interface PageState { url: string; title: string; text: string }

const CHANGE_LINES = 20;
const CHANGE_CHARS = 1_500;

function visibleLines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

function linesOnlyIn(next: string[], previous: string[]): string[] {
  const left = new Map<string, number>();
  for (const line of previous) left.set(line, (left.get(line) ?? 0) + 1);
  return next.filter((line) => {
    const count = left.get(line) ?? 0;
    if (count) left.set(line, count - 1);
    return !count;
  });
}

function listLines(lines: string[]): string {
  const shown: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (shown.length === CHANGE_LINES || chars + line.length > CHANGE_CHARS) break;
    shown.push(JSON.stringify(line));
    chars += line.length;
  }
  return shown.join(", ") + (shown.length < lines.length ? ` and ${lines.length - shown.length} more lines` : "");
}

const SENSITIVE_PARAM = /token|code|key|secret|pass|pwd|auth|session|sig|otp|state|nonce|credential|ticket|email/iu;
/** A hash route names a page; any other fragment may carry a token, as OAuth's `#access_token=…` does. */
const HASH_ROUTE = /^#!?\/[\w\-./~%]*$/u;

/** Origin, path and query with sensitive values (and any email) replaced by `…`; no credentials, no fragment beyond a hash route. */
export function sanitizeUrl(href: string): string {
  let url: URL;
  try { url = new URL(href); } catch {
    try { url = new URL(`https://${href}`); } catch { return ""; }
    if (!url.hostname.includes(".")) return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return url.protocol === "about:" ? "about:blank" : `${url.protocol}…`;
  const query = [...url.searchParams].map(([key, value]) =>
    `${encodeURIComponent(key)}=${SENSITIVE_PARAM.test(key) || value.includes("@") ? "…" : encodeURIComponent(value)}`).join("&");
  const text = `${url.origin}${url.pathname}${query ? `?${query}` : ""}${HASH_ROUTE.test(url.hash) ? url.hash : ""}`;
  return text.length > 500 ? `${text.slice(0, 499)}…` : text;
}

export function describePageChange(before: PageState, after: PageState): string {
  if (after.url !== before.url) {
    return `The page is now ${sanitizeUrl(after.url) || "a new address"}${after.title ? ` (${JSON.stringify(after.title)})` : ""}. Refs from earlier snapshots do not apply to it; take a snapshot before acting on refs.`;
  }
  const previous = visibleLines(before.text);
  const next = visibleLines(after.text);
  const added = linesOnlyIn(next, previous);
  const removed = linesOnlyIn(previous, next);
  const title = after.title !== before.title ? ` The title is now ${JSON.stringify(after.title)}.` : "";
  if (!added.length && !removed.length) return `The visible text of the page did not change.${title}`;
  return [
    added.length ? `Text that appeared on the page: ${listLines(added)}.` : "",
    removed.length ? `Text that disappeared: ${listLines(removed)}.` : "",
  ].filter(Boolean).join(" ") + title;
}

/** Images and binary data pass through: a screenshot cannot be scrubbed. */
export function scrubBrowserResult(result: unknown, scrub: (text: string) => string, depth = 0): unknown {
  if (typeof result === "string") return scrub(result);
  if (depth > 32 || result === null || typeof result !== "object") return result;
  if (Array.isArray(result)) return result.map((item) => scrubBrowserResult(item, scrub, depth + 1));
  const record = result as Record<string, unknown>;
  const binary = record.type === "image" || record.type === "audio";
  return Object.fromEntries(Object.entries(record).map(([key, value]) =>
    [key, (binary && key === "data") || key === "blob" ? value : scrubBrowserResult(value, scrub, depth + 1)]));
}
