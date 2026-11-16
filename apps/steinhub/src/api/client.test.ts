import type { ServerFrame } from "@openmausbot/phone-protocol/wire.ts";
import { desktopClient, type StreamFrame } from "@/api/client";
import { DesktopError, problemText } from "@/api/errors";
import { httpTransport, type Transport } from "@/api/transport";
import { fakeFetch, jsonResponse, pushStream, streamResponse } from "@/testing/fake-desktop";

const BASE = "http://mac.local:8810";

function recordingTransport(reply: unknown = {}) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const transport: Transport = {
    baseUrl: BASE,
    request: async <T,>(method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      return reply as T;
    },
    stream: async () => undefined,
  };
  return { transport, calls };
}

describe("desktopClient", () => {
  test("sends a message to the bot's thread with its send id", async () => {
    const { transport, calls } = recordingTransport({ threadId: "t1" });
    await desktopClient(transport).send("bot one", { text: "hi", threadId: "t1", sendId: "s1" });
    expect(calls).toEqual([{ method: "POST", path: "/api/bots/bot%20one/messages", body: { text: "hi", threadId: "t1", sendId: "s1" } }]);
  });

  test("answers an approval on the thread's respond route", async () => {
    const { transport, calls } = recordingTransport();
    await desktopClient(transport).respond("t1", { requestId: "r1", behavior: "deny" });
    expect(calls[0]).toEqual({ method: "POST", path: "/api/threads/t1/respond", body: { requestId: "r1", behavior: "deny" } });
  });

  test("pages a thread with limit and before", async () => {
    const { transport, calls } = recordingTransport({ messages: [], activeLeafId: null });
    const client = desktopClient(transport);
    await client.messages("t1");
    await client.messages("t1", { limit: 60, before: "m9" });
    expect(calls.map((call) => call.path)).toEqual(["/api/threads/t1/messages", "/api/threads/t1/messages?limit=60&before=m9"]);
  });

  test("toggles and runs automations on their allowlisted routes", async () => {
    const { transport, calls } = recordingTransport({});
    const client = desktopClient(transport);
    await client.setRoutineEnabled("r1", false);
    await client.runRoutine("r1");
    expect(calls).toEqual([
      { method: "PATCH", path: "/api/routines/r1", body: { enabled: false } },
      { method: "POST", path: "/api/routines/r1/run", body: {} },
    ]);
  });

  test("turns the event stream into frames with their cursors, asking for no screens", async () => {
    const stream = pushStream();
    const { fetch, calls } = fakeFetch({ "GET /api/events": streamResponse(stream) });
    const client = desktopClient(httpTransport({ baseUrl: BASE, token: "tok", fetch }));
    const frames: StreamFrame[] = [];
    const done = client.events("abc:4", (frame) => frames.push(frame), new AbortController().signal);
    stream.frame({ kind: "hello", cursor: "abc:4", resumed: true });
    stream.send("data: not json\n\n");
    stream.frame({ kind: "bot.deleted", botId: "b1" } satisfies ServerFrame, "abc:5");
    stream.end();
    await done;
    expect(calls[0].url).toBe(`${BASE}/api/events?screens=off&since=abc%3A4`);
    expect(frames).toEqual([
      { frame: { kind: "hello", cursor: "abc:4", resumed: true }, cursor: undefined },
      { frame: { kind: "bot.deleted", botId: "b1" }, cursor: "abc:5" },
    ]);
  });
});

describe("httpTransport", () => {
  test("sends the device token as a bearer and no Origin", async () => {
    const { fetch, calls } = fakeFetch({ "GET /api/bots": jsonResponse(200, { bots: [] }) });
    await httpTransport({ baseUrl: `${BASE}/`, token: "tok", fetch }).request("GET", "/api/bots");
    expect(calls[0].url).toBe(`${BASE}/api/bots`);
    expect(calls[0].headers.authorization).toBe("Bearer tok");
    expect(Object.keys(calls[0].headers).map((name) => name.toLowerCase())).not.toContain("origin");
  });

  test.each([
    [401, "signed-out"],
    [426, "update-app"],
    [404, "refused"],
    [503, "starting"],
    [502, "server"],
  ] as const)("maps status %i to %s", async (status, kind) => {
    const { fetch } = fakeFetch({ "GET /api/bots": jsonResponse(status, { error: "nope" }) });
    const failure = httpTransport({ baseUrl: BASE, token: "tok", fetch }).request("GET", "/api/bots");
    await expect(failure).rejects.toMatchObject({ kind, status, message: "nope" });
  });

  test("an unreachable computer is offline, with a sentence that says what to do", async () => {
    const { fetch } = fakeFetch({});
    const failure = await httpTransport({ baseUrl: BASE, token: "tok", fetch })
      .request("GET", "/api/bots")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DesktopError);
    expect((failure as DesktopError).kind).toBe("offline");
    expect(problemText(failure, "Mac Studio")).toBe(
      "Couldn't reach Mac Studio. Check that it's on and that this phone is on the same Wi-Fi or tailnet, then try again.",
    );
  });

  test("a reply that isn't JSON is a bad reply", async () => {
    const { fetch } = fakeFetch({ "GET /api/bots": { status: 200, text: () => Promise.resolve("<html>"), body: null } });
    await expect(httpTransport({ baseUrl: BASE, token: "tok", fetch }).request("GET", "/api/bots")).rejects.toMatchObject({ kind: "bad-reply" });
  });

  test("a refused stream rejects with the refusal", async () => {
    const { fetch } = fakeFetch({ "GET /api/events": jsonResponse(401, { error: "pair this device" }) });
    const transport = httpTransport({ baseUrl: BASE, token: "tok", fetch });
    await expect(transport.stream("/api/events", () => undefined, new AbortController().signal)).rejects.toMatchObject({ kind: "signed-out" });
  });
});
