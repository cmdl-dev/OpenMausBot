import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_PUSH_KINDS, phonePushCollapseId } from "../shared/phone-push.ts";
import type { ApnsOutcome } from "./apns-direct.ts";
import { PhonePush, registrationSchema, type DirectPush } from "./phone-push.ts";

const CREDENTIAL = `omb_install_${"a".repeat(22)}.${"b".repeat(43)}`;
const APNS = "ab".repeat(32);
const APNS_2 = "cd".repeat(32);
const FCM = `fcmInstance_1:APA91b${"x".repeat(140)}`;
const PHONE = "session:phone-1";
const BUNDLE = "com.example.steinhub";
const everyone = () => true;

let dataDir: string;
beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), "omb-phone-push-direct-")); });
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

const notification = (overrides: Record<string, unknown> = {}) => ({
  kind: "approval", botId: "bot_1", botName: "Scout", threadId: "th_1", title: "Scout needs approval", body: "PRIVATE: payroll", ...overrides,
});

function harness(options: { bundle?: string | null; relayOn?: boolean; outcomes?: ApnsOutcome["kind"][] } = {}) {
  const sends: Array<{ device: Record<string, unknown>; push: Record<string, unknown>; collapseId?: string }> = [];
  const relayCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const outcomes = [...(options.outcomes ?? [])];
  const direct: DirectPush = {
    bundle: () => (options.bundle === undefined ? BUNDLE : options.bundle),
    send: async (device, push, collapseId) => {
      sends.push({ device: { ...device }, push: { ...push }, ...(collapseId ? { collapseId } : {}) });
      const kind = outcomes.shift() ?? "sent";
      return kind === "sent" || kind === "dead" ? { kind } : { kind, status: kind === "retry" ? 503 : 400, reason: "x" };
    },
  };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    relayCalls.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) });
    return new Response("{}", { status: 202 });
  }) as typeof fetch;
  const push = new PhonePush({
    dataDir,
    access: () => (options.relayOn ? { controlPlane: "https://accounts.openmausbot.test", credential: CREDENTIAL } : null),
    enabled: () => Boolean(options.relayOn),
    direct,
    live: () => false,
    room: () => undefined,
    fetchImpl,
    log: () => {},
  });
  return { push, sends, relayCalls };
}

describe("pushes to an app whose APNs key this server holds", () => {
  it("register without the relay's switch or account, read on, and keep the bundle and quiet hours", async () => {
    const { push, relayCalls } = harness();
    const quiet = { start: "22:00", end: "07:00", timeZone: "America/Los_Angeles" };
    const answer = await push.register(PHONE, { platform: "apns", token: APNS, environment: "sandbox", bundle: BUNDLE, quiet, kinds: ["alert", "wait", "approval"] });
    expect(answer).toMatchObject({ push: "on", relay: "registered", device: { platform: "apns", environment: "sandbox", kinds: ["alert", "wait", "approval"], bundle: BUNDLE, quiet } });
    expect(JSON.stringify(answer)).not.toContain(APNS);
    expect(relayCalls).toEqual([]);
    const reread = new PhonePush({ dataDir, access: () => null, enabled: () => false, live: () => false, room: () => undefined });
    expect(reread.answer(PHONE).device).toMatchObject({ bundle: BUNDLE, quiet });
  });

  it("send an alert with its headline and message straight to Apple, and nothing to the relay", async () => {
    const { push, sends, relayCalls } = harness();
    await push.register(PHONE, { platform: "apns", token: APNS, environment: "sandbox", bundle: BUNDLE, kinds: ["alert"], pairing: "pair-tag-0001" });
    push.offer({ notification: notification({ kind: "alert", messageId: "msg_7", body: "Lease renewal due Friday" }), seq: 9 }, everyone);
    push.offer({ notification: notification({ kind: "approval", threadId: "th_2" }), seq: 10 }, everyone);
    await push.flush();
    expect(relayCalls).toEqual([]);
    expect(sends).toEqual([{
      device: { token: APNS, environment: "sandbox", pairing: "pair-tag-0001" },
      push: { kind: "alert", title: "Scout flagged something for you", botId: "bot_1", botName: "Scout", threadId: "th_1", messageId: "msg_7", body: "Lease renewal due Friday" },
      collapseId: phonePushCollapseId("th_1", 9),
    }]);
  });

  it("keep every other kind content-free, and forget a token Apple dropped", async () => {
    const { push, sends } = harness({ outcomes: ["sent", "dead"] });
    await push.register(PHONE, { platform: "apns", token: APNS, bundle: BUNDLE, kinds: ["wait", "approval"] });
    push.offer({ notification: notification({ kind: "wait", messageId: "msg_8" }), seq: 11 }, everyone);
    await push.flush();
    expect(sends[0]!.push).toEqual({ kind: "wait", title: "Scout's wait is over", botId: "bot_1", botName: "Scout", threadId: "th_1", messageId: "msg_8" });
    push.offer({ notification: notification({ kind: "approval", threadId: "th_2" }), seq: 12 }, everyone);
    await push.flush();
    expect(push.answer(PHONE).device).toBeNull();
  });

  it("leave another app, or a server without the key, to the relay's switch as before", async () => {
    const other = harness({ bundle: "com.example.other" });
    expect(await other.push.register(PHONE, { platform: "apns", token: APNS, bundle: BUNDLE })).toEqual({ push: "off", relay: "off", device: null });
    const keyless = harness({ bundle: null });
    expect(await keyless.push.register(PHONE, { platform: "apns", token: APNS, bundle: BUNDLE })).toEqual({ push: "off", relay: "off", device: null });
  });

  it("send the relay only the fields it takes, and keep the old default kinds", async () => {
    const { push, sends, relayCalls } = harness({ relayOn: true });
    expect((await push.register(PHONE, { platform: "apns", token: APNS_2 })).device?.kinds).toEqual([...DEFAULT_PUSH_KINDS]);
    await push.register(PHONE, { platform: "apns", token: APNS_2, kinds: ["alert"] });
    push.offer({ notification: notification({ kind: "alert", messageId: "msg_7", body: "headline" }), seq: 13 }, everyone);
    await push.flush();
    const relayed = relayCalls.filter((call) => call.path.endsWith("/send"));
    expect(relayed).toHaveLength(1);
    expect(relayed[0]!.body.notification).toEqual({ kind: "alert", title: "Scout flagged something for you", botId: "bot_1", botName: "Scout", threadId: "th_1" });
    expect(sends).toEqual([]);
  });

  it("refuse a malformed bundle or quiet window", () => {
    expect(registrationSchema.safeParse({ platform: "apns", token: APNS, bundle: "not a bundle" }).success).toBe(false);
    expect(registrationSchema.safeParse({ platform: "apns", token: APNS, quiet: { start: "25:00", end: "07:00", timeZone: "UTC" } }).success).toBe(false);
    expect(registrationSchema.safeParse({ platform: "apns", token: APNS, quiet: { start: "22:00", end: "07:00", timeZone: "Mars/Olympus" } }).success).toBe(false);
    expect(registrationSchema.safeParse({ platform: "apns", token: APNS, bundle: BUNDLE, quiet: { start: "22:00", end: "07:00", timeZone: "Europe/Paris" } }).success).toBe(true);
    expect(registrationSchema.safeParse({ platform: "fcm", token: FCM, bundle: BUNDLE }).success).toBe(false);
  });
});
