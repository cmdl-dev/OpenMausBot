import type { BotsResponse, WireMessagePage } from "@openmausbot/phone-protocol/responses.ts";
import type { WireMessage } from "@openmausbot/phone-protocol/wire.ts";
import { Stack } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import type { Session } from "@/api/session";
import { fakeFetch, jsonResponse, pushStream, streamResponse, type Call } from "@/testing/fake-desktop";
import { network, secureValues } from "@/testing/native-mocks";

jest.mock("expo-secure-store", () => jest.requireActual("@/testing/native-mocks").secureStore);
jest.mock("expo-crypto", () => jest.requireActual("@/testing/native-mocks").crypto);
jest.mock("expo-camera", () => jest.requireActual("@/testing/native-mocks").camera);
jest.mock("expo/fetch", () => ({ fetch: (...args: unknown[]) => jest.requireActual("@/testing/native-mocks").network.fetch(...args) }));

function DrawerWithoutAnimation() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

const AT = Date.UTC(2026, 10, 16, 9, 30);

const SESSION: Session = {
  token: "device-token-1",
  urls: ["http://mac.local:8810"],
  serverName: "Ada's Mac",
  device: { id: "d1", name: "Test iPhone", createdAt: 1, lastSeenAt: 1 },
  pairedAt: AT,
};

const BOTS: BotsResponse = {
  bots: [
    {
      id: "b1",
      threadId: "t1",
      name: "MausBot",
      title: "Chief of Staff",
      description: "",
      notifications: true,
      color: "purple",
      avatarUrl: null,
      unread: false,
      modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
      createdAt: 1,
      tasks: [{ threadId: "t1", title: "Lease renewal", createdAt: AT }],
      messages: [],
      activeLeafId: null,
    },
  ],
  botQueuedMessages: {},
  sections: [],
  groups: [],
  computerControl: {},
};

const CARD: WireMessage = {
  id: "m3",
  role: "bot",
  kind: "options",
  at: AT + 2,
  card: {
    title: "Send this reply to Jordan?",
    subtitle: "Hi Jordan, would you consider $2,450?",
    options: ["Allow", "Deny"],
    tool: "mcp__gmail__send_email",
    requestId: "r1",
    requestType: "permission",
  },
};

const PAGE: WireMessagePage = {
  messages: [
    { id: "m1", role: "user", kind: "text", text: "Draft a counter offer", at: AT },
    { id: "m2", role: "bot", kind: "text", text: "Here's a draft at $2,450.", at: AT + 1 },
    CARD,
  ],
  activeLeafId: "m3",
};

async function openChat() {
  const events = pushStream();
  const desktop = fakeFetch({
    "GET /api/events": streamResponse(events),
    "GET /api/bots": jsonResponse(200, BOTS),
    "GET /api/instances": jsonResponse(200, { instances: [] }),
    "GET /api/routines": jsonResponse(200, { routines: [], runs: [] }),
    "GET /api/companion/endpoints": jsonResponse(200, { serverName: "Ada's Mac", endpoints: [] }),
    "GET /api/threads/t1/messages": jsonResponse(200, PAGE),
    "POST /api/bots/b1/messages": (call: Call) => {
      const body = call.body as { text: string; sendId: string };
      return jsonResponse(200, { threadId: "t1", message: { id: "m4", role: "user", kind: "text", text: body.text, sendId: body.sendId, at: AT + 3 } });
    },
    "POST /api/threads/t1/respond": jsonResponse(200, { ok: true }),
  });
  network.fetch = desktop.fetch;
  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl: "/chat/t1" });
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/events")).toBe(true));
  await act(async () => events.frame({ kind: "hello", cursor: "s:1", resumed: false }));
  expect(await screen.findByText("Here's a draft at $2,450.")).toBeTruthy();
  return { events, desktop };
}

beforeEach(() => {
  secureValues.clear();
  secureValues.set("steinhub.demo", "off");
  secureValues.set("steinhub.session", JSON.stringify(SESSION));
});

test("sends a line into the thread and shows the computer's echo", async () => {
  const { desktop } = await openChat();
  expect(screen.getByText("Lease renewal")).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText("Message"), "Make it 24 months");
  await fireEvent.press(screen.getByLabelText("Send"));

  await waitFor(() => expect(desktop.calls.some((call) => call.method === "POST" && call.path === "/api/bots/b1/messages")).toBe(true));
  const send = desktop.calls.find((call) => call.path === "/api/bots/b1/messages");
  expect(send?.body).toEqual({ text: "Make it 24 months", threadId: "t1", sendId: expect.stringMatching(/^uuid-/) });
  expect(send?.headers.authorization).toBe("Bearer device-token-1");
  expect(await screen.findByText("Make it 24 months")).toBeTruthy();
});

test("streams a reply as it arrives, then swaps in the saved message", async () => {
  const { events } = await openChat();
  const delta = (eventId: string, piece: string) =>
    events.frame({
      kind: "runtime",
      event: { eventId, provider: "claude", threadId: "t1", createdAt: "", itemId: "i1", type: "content.delta", streamKind: "assistant_text", delta: piece },
    });

  await act(async () => {
    delta("e1", "Jordan usually ");
    delta("e2", "says yes.");
  });
  expect(await screen.findByText("Jordan usually says yes.")).toBeTruthy();
  expect(screen.getByText("Writing")).toBeTruthy();

  await act(async () =>
    events.frame({ kind: "message", threadId: "t1", message: { id: "m5", role: "bot", kind: "text", text: "Jordan usually says yes.", itemId: "i1", at: AT + 5 } }),
  );
  await waitFor(() => expect(screen.queryByText("Writing")).toBeNull());
  expect(screen.getAllByText("Jordan usually says yes.")).toHaveLength(1);
});

test("approves an inline approval card, which collapses once the computer settles it", async () => {
  const { desktop, events } = await openChat();
  expect(screen.getByText("Send this reply to Jordan?")).toBeTruthy();
  expect(screen.getByText("Send email")).toBeTruthy();

  await fireEvent.press(screen.getByText("Approve"));
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/threads/t1/respond")).toBe(true));
  expect(desktop.calls.find((call) => call.path === "/api/threads/t1/respond")?.body).toEqual({ requestId: "r1", behavior: "allow" });

  await act(async () => events.frame({ kind: "message.patch", threadId: "t1", message: { ...CARD, card: { ...CARD.card!, answered: "Allow" } } }));
  expect(await screen.findByText("Approved")).toBeTruthy();
  expect(screen.queryByText("Approve")).toBeNull();
});

test("deny sends deny", async () => {
  const { desktop } = await openChat();
  await fireEvent.press(screen.getByText("Deny"));
  await waitFor(() => expect(desktop.calls.find((call) => call.path === "/api/threads/t1/respond")?.body).toEqual({ requestId: "r1", behavior: "deny" }));
});

test("the field stays empty after Send when the keyboard writes its correction back", async () => {
  const { desktop } = await openChat();
  const field = screen.getByLabelText("Message");
  await fireEvent.changeText(field, "let me know when I get the berification");
  await fireEvent.press(screen.getByLabelText("Send"));
  await fireEvent.changeText(field, "let me know when I get the verification");

  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/bots/b1/messages")).toBe(true));
  expect(screen.getByLabelText("Message").props.value).toBe("");

  const later = Date.now() + 1_000;
  const clock = jest.spyOn(Date, "now").mockReturnValue(later);
  await fireEvent.changeText(screen.getByLabelText("Message"), "Thanks");
  clock.mockRestore();
  expect(screen.getByLabelText("Message").props.value).toBe("Thanks");
});
