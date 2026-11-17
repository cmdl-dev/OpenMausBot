// POST /api/internal/notify-person: a bot flags something important for the person (notify_person). The note lands in
// the conversation the turn runs in, and an "alert" notification points at it, so the person's phone opens right there.
import type { Notification } from "../../shared/notification.ts";
import { buildNotification } from "../notify.ts";
import type { BotRecord, Message } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const NOTIFY_PERSON_PATH = "/api/internal/notify-person";
export const NOTIFY_TITLE_MAX = 120;
export const NOTIFY_TEXT_MAX = 4_000;
/** Per bot: an alert that is not rare stops being one. */
export const NOTIFY_LIMIT = 3;
export const NOTIFY_WINDOW_MS = 10 * 60_000;

export const NOTIFY_MESSAGES = {
  title: `notify_person needs a title of at most ${NOTIFY_TITLE_MAX} characters: the headline their lock screen shows.`,
  text: `notify_person needs text of at most ${NOTIFY_TEXT_MAX} characters: what they should look at and why.`,
  notYours: "This conversation is not yours.",
  limit: `You already alerted the person ${NOTIFY_LIMIT} times in the last ${NOTIFY_WINDOW_MS / 60_000} minutes. Put the rest in your reply; they will see it when they open the chat.`,
  off: "The person turned notifications off for you, so nothing was sent. Say it in your reply instead.",
} as const;

export interface NotifyPersonDeps {
  store: {
    appendMessage(threadId: string, message: Omit<Message, "id" | "at">): Message;
  };
  /** Where the turn's thread lives: null when it is not the bot's own, and its room when it is one. */
  conversation(botId: string, threadId: string): { group?: { id: string; name: string } } | null;
  notify(notification: Notification | null): void;
  /** The live turn's id in that thread, so the note is never taken for the turn's reply. */
  turnOf(threadId: string): string | undefined;
  now?: () => number;
}

function line(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/[\p{Cc}\u2028\u2029]+/gu, " ").replace(/\s+/g, " ").trim();
  return text && [...text].length <= max ? text : null;
}

export function createNotifyPerson(deps: NotifyPersonDeps) {
  const now = deps.now ?? Date.now;
  const sent = new Map<string, number[]>();
  return {
    /** The route for one turn: the bot that runs it, and the thread it runs in. */
    route(turn: { botId: string; threadId: string }, sender: Pick<BotRecord, "id" | "name" | "color" | "notifications" | "avatarUrl">): RouteHandler {
      return async ({ req, res, path, method, json, readBody }) => {
        if (method !== "POST" || path !== NOTIFY_PERSON_PATH) return PASS;
        let body: Record<string, unknown> = {};
        try {
          const read = await readBody(req, 32_768);
          if (read && typeof read === "object" && !Array.isArray(read)) body = read as Record<string, unknown>;
        } catch {
          return json(res, 400, { error: NOTIFY_MESSAGES.text });
        }
        const title = line(body.title, NOTIFY_TITLE_MAX);
        if (!title) return json(res, 400, { error: NOTIFY_MESSAGES.title });
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text || text.length > NOTIFY_TEXT_MAX) return json(res, 400, { error: NOTIFY_MESSAGES.text });
        const where = deps.conversation(sender.id, turn.threadId);
        if (!where) return json(res, 403, { error: NOTIFY_MESSAGES.notYours });
        if (sender.notifications === false) return json(res, 409, { error: NOTIFY_MESSAGES.off });
        const at = now();
        const recent = (sent.get(sender.id) ?? []).filter((time) => at - time < NOTIFY_WINDOW_MS);
        if (recent.length >= NOTIFY_LIMIT) return json(res, 429, { error: NOTIFY_MESSAGES.limit });
        sent.set(sender.id, [...recent, at]);
        const turnId = deps.turnOf(turn.threadId);
        const note = deps.store.appendMessage(turn.threadId, {
          role: "bot",
          kind: "text",
          text,
          alert: { title },
          ...(turnId ? { sentInTurn: turnId } : {}),
          ...(where.group ? { from: { botId: sender.id, name: sender.name, color: sender.color } } : {}),
        });
        deps.notify(buildNotification("alert", { id: sender.id, name: sender.name, notifications: sender.notifications }, turn.threadId, title, {
          ...(sender.avatarUrl ? { avatarUrl: sender.avatarUrl } : {}),
          ...(where.group ? { group: where.group } : {}),
          messageId: note.id,
        }));
        return json(res, 200, { text: "The person was notified. The note is in this chat, and their phone opens it there. Do not repeat it in your reply." });
      };
    },
  };
}
