// The v1 live view's protocol: the actions a viewer's HTTP body may select, and what a view hears while it cannot show.
import { requestedSize } from "./viewport.ts";

type PageSize = { width: number; height: number };

/** Inputs one request may carry, so a remote panel's typing does not wait a round trip per key. */
export const INPUT_BATCH_LIMIT = 64;
/** What a view hears when its browser closed unused: it stops, where reconnecting would start the browser again. */
export const BROWSER_ASLEEP_ERROR = { type: "error", retryable: false, asleep: true, message: "This browser closed after it sat unused, to save memory. Reconnect to open it again." };
/** What a view hears while its browser cannot show it yet; it keeps waiting. */
export const BROWSER_WAITING = { type: "waiting", reason: "busy" };

export class BrowserLiveError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.name = "BrowserLiveError"; this.status = status; }
}

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
}
function number(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
function integer(value: unknown, min: number, max: number): value is number {
  return number(value, min, max) && Number.isSafeInteger(value);
}
function text(value: unknown, max: number): value is string { return typeof value === "string" && value.length <= max; }

/** A restart closes the tabs of every bot on the profile, so a busy one blocks it, unless the browser no longer answers it anyway
 * or the bot is waiting on the person in this browser (an open sign-in card). */
export function browserRestartRefusal(interrupted: boolean, busyBots: ReadonlyArray<{ waitingOnBrowser: boolean }>): string | null {
  return !interrupted && busyBots.some((bot) => !bot.waitingOnBrowser) ? "Stop every bot using this profile before restarting its browser." : null;
}

type Action = { type: "take" | "release" | "restart" } | { type: "ack"; seq: number }
  | { type: "command"; args: string[] } | { type: "input"; message: ObjectValue } | { type: "inputs"; messages: ObjectValue[] }
  | { type: "dialog"; accept: boolean; promptText?: string }
  /** The panel's size in CSS pixels, which the page fills; null for a collapsed panel, which leaves the page as it is. */
  | { type: "resize"; size: PageSize | null };

/** A move the next one replaces changes nothing the page keeps. */
function withoutReplacedMoves(messages: ObjectValue[]): ObjectValue[] {
  return messages.filter((message, at) => {
    const next = messages[at + 1];
    return !(message.eventType === "mouseMoved" && next?.eventType === "mouseMoved" && next.button === message.button && next.modifiers === message.modifiers);
  });
}

/** HTTP bodies can select a fixed action, never a CLI command, flag, port or CDP method. */
export function parseBrowserLiveAction(value: unknown): Action {
  const body = object(value);
  const invalid = () => new BrowserLiveError("Invalid browser action.");
  if (!body) throw invalid();
  if (body.type === "take" || body.type === "release" || body.type === "restart") return { type: body.type };
  if (body.type === "ack" && integer(body.seq, 1, Number.MAX_SAFE_INTEGER)) return { type: "ack", seq: body.seq };
  if (body.type === "resize") {
    if (!number(body.width, 0, 100_000) || !number(body.height, 0, 100_000)) throw invalid();
    return { type: "resize", size: requestedSize(body.width, body.height) };
  }
  if (body.type === "dialog") {
    if (typeof body.accept !== "boolean" || (body.promptText !== undefined && !text(body.promptText, 4096))) throw invalid();
    return { type: "dialog", accept: body.accept, ...(body.promptText === undefined ? {} : { promptText: body.promptText }) };
  }
  if (body.type === "input_batch") {
    if (!Array.isArray(body.events) || !body.events.length || body.events.length > INPUT_BATCH_LIMIT) throw invalid();
    const messages = body.events.map((event: unknown) => {
      const parsed = parseBrowserLiveAction(event);
      if (parsed.type !== "input") throw invalid();
      return parsed.message;
    });
    return { type: "inputs", messages: withoutReplacedMoves(messages) };
  }
  if (body.type === "back" || body.type === "forward" || body.type === "reload") return { type: "command", args: [body.type] };
  if (body.type === "navigate" || body.type === "tab-new") {
    if (body.type === "tab-new" && body.url === undefined) return { type: "command", args: ["tab", "new"] };
    // eslint-disable-next-line no-control-regex -- Reject control characters before URL parsing normalizes them.
    if (!text(body.url, 8192) || !body.url || /[\u0000-\u0020\u007f\\]/u.test(body.url)) throw invalid();
    let url: URL;
    try { url = new URL(body.url); } catch { throw invalid(); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw invalid();
    return { type: "command", args: body.type === "navigate" ? ["open", url.href] : ["tab", "new", url.href] };
  }
  if (body.type === "tab-select" || body.type === "tab-close") {
    if (typeof body.tabId !== "string" || !/^t[1-9]\d{0,8}$/.test(body.tabId)) throw invalid();
    return { type: "command", args: body.type === "tab-select" ? ["tab", body.tabId] : ["tab", "close", body.tabId] };
  }
  if (body.type === "input_mouse") {
    if (!["mouseMoved", "mousePressed", "mouseReleased", "mouseWheel"].includes(String(body.eventType))
        || !number(body.x, 0, 8192) || !number(body.y, 0, 8192)) throw invalid();
    const button = body.button ?? "none";
    const clickCount = body.clickCount ?? 0, modifiers = body.modifiers ?? 0;
    const deltaX = body.deltaX ?? 0, deltaY = body.deltaY ?? 0;
    if (!["none", "left", "middle", "right"].includes(String(button)) || !integer(clickCount, 0, 3)
        || !integer(modifiers, 0, 15) || !number(deltaX, -10000, 10000) || !number(deltaY, -10000, 10000)) throw invalid();
    return { type: "input", message: { type: "input_mouse", eventType: body.eventType, x: body.x, y: body.y, button, clickCount, modifiers, deltaX, deltaY } };
  }
  if (body.type === "input_keyboard") {
    if (body.eventType === "char") {
      if (!text(body.text, 4096) || !body.text) throw invalid();
      return { type: "input", message: { type: "input_keyboard", eventType: "char", text: body.text } };
    }
    if (!["keyDown", "keyUp"].includes(String(body.eventType)) || !text(body.key, 64) || !body.key) throw invalid();
    const modifiers = body.modifiers ?? 0, keyCode = body.windowsVirtualKeyCode ?? 0;
    if (!integer(modifiers, 0, 15) || !integer(keyCode, 0, 255)
        || (body.code !== undefined && !text(body.code, 64)) || (body.text !== undefined && !text(body.text, 4096))) throw invalid();
    return { type: "input", message: { type: "input_keyboard", eventType: body.eventType, key: body.key,
      modifiers, windowsVirtualKeyCode: keyCode, ...(body.code === undefined ? {} : { code: body.code }), ...(body.text === undefined ? {} : { text: body.text }) } };
  }
  throw invalid();
}
