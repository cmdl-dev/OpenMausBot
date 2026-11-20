import { describe, expect, it } from "vitest";

import { denyReason, isBrowserControlAccess, isCompanionNotice } from "../src/routes.ts";

const ask = (method: string, path: string, authenticated = true) =>
  denyReason({ method, path, authenticated });

describe("credentials", () => {
  it("lets an unpaired device pair, and do nothing else", () => {
    expect(ask("POST", "/api/pair", false)).toBeNull();
    expect(ask("GET", "/api/bots", false)).toEqual({
      status: 401,
      error: "pair this device from Remote access settings on the host computer",
    });
    expect(ask("POST", "/api/files", false)?.status).toBe(401);
  });

  it("lets anyone curl liveness — it is the unauthenticated smoke test", () => {
    expect(ask("GET", "/api/health", false)).toBeNull();
    expect(ask("POST", "/api/health", false)?.status).toBe(401);
    expect(ask("GET", "/api/healthz", false)?.status).toBe(401);
  });
});

describe("what the app may do", () => {
  // Every request the phone apps make: if one fails, a phone screen is broken.
  const calls: Array<[string, string]> = [
    ["GET", "/api/health"],
    ["PUT", "/api/phones/self"],
    ["GET", "/api/phones/self/jobs"],
    ["POST", "/api/phones/self/jobs/j1/result"],
    ["PUT", "/api/push/device"],
    ["GET", "/api/push/device"],
    ["DELETE", "/api/push/device"],
    ["PUT", "/api/push/activity"],
    ["GET", "/api/push/activity"],
    ["DELETE", "/api/push/activity"],
    ["GET", "/api/config"],
    ["GET", "/api/events"],
    ["GET", "/api/instances"],
    ["POST", "/api/instances/claude/claude-update"],
    ["POST", "/api/instances/claude.work/claude-update"],
    ["GET", "/api/team-map"],
    ["GET", "/api/companion/endpoints"],
    ["GET", "/api/bots"],
    ["POST", "/api/bots"],
    ["PATCH", "/api/bots/bot_123"],
    ["DELETE", "/api/bots/bot_123"],
    ["PUT", "/api/bots/order"],
    ["POST", "/api/sidebar-sections"],
    ["POST", "/api/bots/bot_123/messages"],
    ["PATCH", "/api/bots/bot_123/cards/msg_2"],
    ["POST", "/api/bots/bot_123/respond"],
    ["POST", "/api/bots/bot_123/interrupt"],
    ["DELETE", "/api/bots/bot_123/queue/queue_1"],
    ["POST", "/api/bots/bot_123/queue/queue_1/steer"],
    ["POST", "/api/bots/bot_123/read"],
    ["POST", "/api/bots/bot_123/always-allow"],
    ["POST", "/api/bots/bot_123/messages/msg_2/edit"],
    ["GET", "/api/bots/bot_123/overview"],
    ["GET", "/api/bots/bot_123/activity"],
    ["GET", "/api/bots/bot_123/mcp-servers"],
    ["GET", "/api/team-memory"],
    ["POST", "/api/team-memory"],
    ["PATCH", "/api/team-memory/entry_1"],
    ["DELETE", "/api/team-memory/entry_1"],
    ["POST", "/api/bots/bot_123/active-branch"],
    ["POST", "/api/bots/bot_123/compact"],
    ["POST", "/api/bots/bot_123/setup-request"],
    ["DELETE", "/api/bots/bot_123/setup-request"],
    ["POST", "/api/bots/bot_123/tasks"],
    ["POST", "/api/bots/bot_123/tasks/th_1"],
    ["PATCH", "/api/bots/bot_123/tasks/th_1"],
    ["DELETE", "/api/bots/bot_123/tasks/th_1"],
    ["PATCH", "/api/bots/bot_123/profile"],
    ["PATCH", "/api/bots/bot_123/model"],
    ["POST", "/api/bots/bot_123/avatar/generate"],
    ["POST", "/api/bots/bot_123/computer/join"],
    ["POST", "/api/bots/bot_123/secret-cards/message_1/provide"],
    ["POST", "/api/bots/bot_123/computer/control"],
    ["POST", "/api/bots/bot_123/computer/screenshot"],
    ["POST", "/api/bots/bot_123/computer/viewer-close"],
    ["POST", "/api/bots/bot_123/local-computer/screenshot"],
    ["POST", "/api/bots/bot_123/local-computer/join"],
    ["POST", "/api/groups/room-1/messages"],
    ["POST", "/api/groups/room-1/interrupt"],
    ["DELETE", "/api/groups/room-1/queue/queue_1"],
    ["POST", "/api/groups/room-1/queue/queue_1/steer"],
    ["POST", "/api/groups/room-1/read"],
    ["POST", "/api/groups/room-1/tasks"],
    ["POST", "/api/groups/room-1/tasks/th_1"],
    ["PATCH", "/api/groups/room-1/tasks/th_1"],
    ["DELETE", "/api/groups/room-1/tasks/th_1"],
    ["GET", "/api/threads/th_1/messages"],
    ["GET", "/api/threads/th_1/messages/msg_2/image"],
    ["GET", "/api/threads/th_1/messages/msg_2/tool"],
    ["GET", "/api/threads/th_1/messages/msg_2/app"],
    ["GET", "/api/threads/th_1/messages/msg_2/app/download"],
    ["POST", "/api/bots/bot_123/apps/msg_2/rpc"],
    ["POST", "/api/bots/bot_123/apps/msg_2/context"],
    ["POST", "/api/threads/th_1/messages/msg_2/file"],
    ["POST", "/api/threads/th_1/messages/msg_2/reactions"],
    ["GET", "/api/threads/th_1/export"],
    ["POST", "/api/threads/th_1/respond"],
    ["GET", "/api/search"],
    ["GET", "/api/bots/bot_123/skills"],
    ["POST", "/api/attachments"],
    ["GET", "/api/attachments/avatar-123.webp"],
    ["GET", "/api/attachments/voice-note-1.mp3"],
    ["GET", "/api/attachments/voice-note-1.wav"],
    ["DELETE", "/api/attachments/3f2c9a1e-photo.jpg"],
    ["POST", "/api/files"],
    ["GET", "/api/tts/voices"],
    ["POST", "/api/tts/prepare"],
    ["POST", "/api/tts/speak"],
    ["POST", "/api/live/session"],
    ["POST", "/api/live/call/end"],
    ["GET", "/api/live/call"],
    ["GET", "/api/calls"],
    ["GET", "/api/calls/call_1"],
    ["PATCH", "/api/live/settings"],
    ["GET", "/api/routines"],
    ["POST", "/api/routines"],
    ["PATCH", "/api/routines/routine_1"],
    ["DELETE", "/api/routines/routine_1"],
    ["POST", "/api/routines/routine_1/run"],
    ["POST", "/api/routine-runs/run_1/cancel"],
    ["POST", "/api/routine-runs/run_1/seen"],
    // The stopped turn's "Continue when your limit resets" makes a one-time automation, like POST /api/routines.
    ["POST", "/api/limit-resets/continue"],
    ["GET", "/api/connectors/catalog"],
    ["GET", "/api/connectors/connected"],
    ["GET", "/api/connectors"],
    ["POST", "/api/connectors/slack/authorize"],
    ["DELETE", "/api/connectors/slack/accounts/ca_123"],
    ["GET", "/api/bots/bot_123/connector-cards/msg_2/status"],
    ["POST", "/api/bots/bot_123/connector-cards/msg_2/authorize"],
    ["POST", "/api/bots/bot_123/connector-cards/msg_2/resume"],
    ["POST", "/api/bots/bot_123/connector-cards/msg_2/dismiss"],
    ["POST", "/api/bots/bot_123/secret-cards/msg_2/resume"],
    ["POST", "/api/bots/bot_123/secret-cards/msg_2/dismiss"],
    ["POST", "/api/bots/bot_123/secret-cards/msg_2/save"],
    ["POST", "/api/bots/bot_123/sign-in-cards/msg_3/done"],
    ["POST", "/api/bots/bot_123/sign-in-cards/msg_3/cancel"],
  ];

  for (const [method, path] of calls) {
    it(`allows ${method} ${path}`, () => expect(ask(method, path)).toBeNull());
  }
});

describe("a paired device is the app", () => {
  it("may change anything the app on the computer can", () => {
    for (const [method, path] of [
      ["PATCH", "/api/bots/bot_123"],
      ["PUT", "/api/bots/bot_123/settings"],
      ["POST", "/api/bots"],
      ["DELETE", "/api/bots/bot_123"],
      ["PUT", "/api/config"],
      ["POST", "/api/secrets"],
      ["PUT", "/api/routines/routine_1"],
      ["POST", "/api/routines/routine_1/cancel"],
      ["POST", "/api/engines/codex/install"],
      ["POST", "/api/bots/bot_123/computer/join"],
      ["POST", "/api/bots/bot_123/local-computer/join"],
      ["GET", "/api/bots/b1/browser/live"],
      ["POST", "/api/bots/b1/browser/action"],
      ["POST", "/api/bots/b1/browser/restart"],
      ["GET", "/api/phones"],
      ["GET", "/api/some/route/added/later"],
    ] as Array<[string, string]>) {
      expect(ask(method, path), `${method} ${path}`).toBeNull();
    }
  });

  it("keeps the unpaired-phone notice for the companion alone", () => {
    expect(ask("POST", "/api/live/device-revoked")?.status).toBe(404);
    expect(ask("POST", "/api/live/device-revoked", false)?.status).toBe(401);
    expect(isCompanionNotice("POST", "/api/live/device-revoked")).toBe(true);
    expect(isCompanionNotice("GET", "/api/live/device-revoked")).toBe(false);
    expect(isCompanionNotice("POST", "/api/live/device-revoked/x")).toBe(false);
    expect(isCompanionNotice("POST", "/api/live/call/end")).toBe(false);
  });
});

describe("browser responses", () => {
  it("marks exactly the live stream and the action channel as showing a signed-in browser", () => {
    expect(isBrowserControlAccess("GET", "/api/bots/b1/browser/live")).toBe(true);
    expect(isBrowserControlAccess("POST", "/api/bots/b1/browser/action")).toBe(true);
    expect(isBrowserControlAccess("GET", "/api/bots/b1/messages")).toBe(false);
    expect(isBrowserControlAccess("POST", "/api/bots/b1/computer/join")).toBe(false);
    expect(isBrowserControlAccess("GET", "/api/bots/b1/browser/live/extra")).toBe(false);
  });
});
