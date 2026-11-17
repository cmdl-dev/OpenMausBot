import { describe, expect, it } from "vitest";

import type { Notification } from "../../shared/notification.ts";
import type { Message } from "../store.ts";
import { createNotifyPerson, NOTIFY_LIMIT, NOTIFY_MESSAGES, NOTIFY_PERSON_PATH, NOTIFY_WINDOW_MS } from "./notify-person.ts";
import { PASS, type RouteContext } from "./table.ts";

const BOT = { id: "b1", name: "Scout", color: "purple" as const, notifications: true, avatarUrl: "/api/attachments/scout.png" };

function setup(options: { group?: { id: string; name: string }; owned?: boolean } = {}) {
  let clock = 1_000_000;
  const posted: Array<{ threadId: string; message: Omit<Message, "id" | "at"> }> = [];
  const notified: Array<Notification | null> = [];
  const notifier = createNotifyPerson({
    store: {
      appendMessage: (threadId, message) => {
        posted.push({ threadId, message });
        return { ...message, id: `m${posted.length}`, at: clock } as Message;
      },
    },
    conversation: () => (options.owned === false ? null : options.group ? { group: options.group } : {}),
    notify: (notification) => notified.push(notification),
    turnOf: () => "turn-7",
    now: () => clock,
  });
  type Answer = { status: number; body: Record<string, unknown> };
  const call = async (body: unknown, bot = BOT, path = NOTIFY_PERSON_PATH): Promise<Answer | "pass" | null> => {
    let answer = null as Answer | null;
    const ctx = {
      req: {}, res: {}, path, method: "POST",
      readBody: async () => body,
      json: (_res: unknown, status: number, payload: Record<string, unknown>) => { answer = { status, body: payload }; },
    } as unknown as RouteContext;
    const out = await notifier.route({ botId: bot.id, threadId: "t1" }, bot)(ctx);
    return out === PASS ? "pass" : answer;
  };
  return { call, posted, notified, advance: (ms: number) => { clock += ms; } };
}

describe("notify_person's route", () => {
  it("posts the note in this chat as an alert, and points an alert notification at it", async () => {
    const { call, posted, notified } = setup();
    const answer = await call({ title: " Lease renewal due Friday ", text: "The landlord wants an answer by **Friday**." });
    expect(answer).toMatchObject({ status: 200, body: { text: expect.stringContaining("Do not repeat it") } });
    expect(posted).toEqual([{ threadId: "t1", message: { role: "bot", kind: "text", text: "The landlord wants an answer by **Friday**.", alert: { title: "Lease renewal due Friday" }, sentInTurn: "turn-7" } }]);
    expect(notified).toEqual([{ kind: "alert", botId: "b1", botName: "Scout", threadId: "t1", title: "Scout flagged something for you", body: "Lease renewal due Friday", avatarUrl: BOT.avatarUrl, messageId: "m1" }]);
  });

  it("says who in a room, and refuses a thread that is not the bot's", async () => {
    const room = setup({ group: { id: "g1", name: "Ops" } });
    await room.call({ title: "Outage", text: "The site is down." });
    expect(room.posted[0]!.message.from).toEqual({ botId: "b1", name: "Scout", color: "purple" });
    expect(room.notified[0]).toMatchObject({ groupId: "g1", title: "Scout in Ops flagged something for you" });
    const stranger = setup({ owned: false });
    expect(await stranger.call({ title: "x", text: "y" })).toEqual({ status: 403, body: { error: NOTIFY_MESSAGES.notYours } });
    expect(stranger.posted).toEqual([]);
  });

  it("sends nothing for a bot whose notifications are off, or a malformed call", async () => {
    const { call, posted, notified } = setup();
    expect(await call({ title: "x", text: "y" }, { ...BOT, notifications: false })).toEqual({ status: 409, body: { error: NOTIFY_MESSAGES.off } });
    expect(await call({ title: "", text: "y" })).toEqual({ status: 400, body: { error: NOTIFY_MESSAGES.title } });
    expect(await call({ title: "x".repeat(121), text: "y" })).toEqual({ status: 400, body: { error: NOTIFY_MESSAGES.title } });
    expect(await call({ title: "x" })).toEqual({ status: 400, body: { error: NOTIFY_MESSAGES.text } });
    expect(await call({ title: "x", text: "y" }, BOT, "/api/internal/other")).toBe("pass");
    expect(posted).toEqual([]);
    expect(notified).toEqual([]);
  });

  it(`alerts at most ${NOTIFY_LIMIT} times in ${NOTIFY_WINDOW_MS / 60_000} minutes per bot`, async () => {
    const { call, posted, advance } = setup();
    for (let index = 0; index < NOTIFY_LIMIT; index++) expect(await call({ title: `t${index}`, text: "y" })).toMatchObject({ status: 200 });
    expect(await call({ title: "one more", text: "y" })).toEqual({ status: 429, body: { error: NOTIFY_MESSAGES.limit } });
    advance(NOTIFY_WINDOW_MS);
    expect(await call({ title: "later", text: "y" })).toMatchObject({ status: 200 });
    expect(posted).toHaveLength(NOTIFY_LIMIT + 1);
  });
});
