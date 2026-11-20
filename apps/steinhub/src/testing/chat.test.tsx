import type { BotsResponse, WireMessagePage } from "@openmausbot/phone-protocol/responses.ts";
import type { WireMessage } from "@openmausbot/phone-protocol/wire.ts";
import type { WidgetNode } from "@openmausbot/phone-protocol/widget.ts";
import { router, Stack } from "expo-router";
import { Linking } from "react-native";
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

const BRIEF: WidgetNode = {
  type: "Card",
  id: "root",
  title: "Your brief",
  caption: "Thursday, November 19",
  children: [
    { type: "Title", id: "n1", value: "Needs you", size: "sm" },
    { type: "Text", id: "n2", value: "Nothing needs you right now." },
    { type: "Title", id: "n3", value: "Important emails", size: "sm" },
    {
      type: "Col",
      id: "n4",
      gap: 1,
      children: [
        { type: "Text", id: "n5", value: "McKnight, Riley M: Final Approval for FEINBERG ENTERPRISE LLC", weight: "medium" },
        { type: "Caption", id: "n6", value: "Asks you to define." },
        {
          type: "Row",
          id: "n7",
          gap: 2,
          wrap: true,
          children: [
            { type: "Button", id: "n8", label: "Draft a reply to McKnight, Riley M", style: "primary", onClickAction: { type: "draft_reply", payload: { messageId: "g1" } } },
            { type: "Button", id: "n9", label: "Open in Gmail", style: "secondary", onClickAction: { type: "open_url", payload: { url: "https://mail.google.com/mail/#all/g1" } } },
            { type: "Button", id: "n10", label: "Dismiss McKnight, Riley M's email", style: "secondary", onClickAction: { type: "dismiss_row", payload: { messageId: "g1" } } },
          ],
        },
      ],
    },
    { type: "Title", id: "n11", value: "Routines", size: "sm" },
    {
      type: "Row",
      id: "n12",
      gap: 3,
      align: "center",
      children: [
        { type: "Col", id: "n13", flex: 1, children: [{ type: "Text", id: "n14", value: "Update the cat's feeding schedule", weight: "medium" }] },
        { type: "Button", id: "n15", label: "Open", style: "secondary", onClickAction: { type: "open_thread", payload: { botId: "b1", threadId: "t2" } } },
      ],
    },
  ],
};

const BRIEF_MESSAGE: WireMessage = {
  id: "w1",
  role: "bot",
  kind: "widget",
  at: AT + 3,
  serverCard: true,
  text: "**Your brief** · Thursday, November 19\nNeeds you\n[Draft a reply to McKnight, Riley M] · [Open in Gmail]",
  widget: { v: 1, root: BRIEF, rev: 2 },
};

const PAGE: WireMessagePage = {
  messages: [
    { id: "m0", role: "user", kind: "text", text: 'The lease\n\n<attached-image path="/api/attachments/lease.jpg" name="lease.jpg" />', at: AT - 3 },
    {
      id: "m0b",
      role: "bot",
      kind: "text",
      text: "",
      at: AT - 2,
      attachments: [
        { kind: "image", path: "/api/attachments/chart.png", mime: "image/png", name: "chart.png" },
        { kind: "image", path: "/api/attachments/screen.png", mime: "image/png", name: "screen.png", fromTool: true },
      ],
    },
    { id: "m1", role: "user", kind: "text", text: "Draft a counter offer", at: AT },
    { id: "m2", role: "bot", kind: "text", text: "Here's a draft at $2,450.", at: AT + 1 },
    CARD,
  ],
  activeLeafId: "m3",
};

async function openChat(page: WireMessagePage = PAGE) {
  const events = pushStream();
  const desktop = fakeFetch({
    "GET /api/events": streamResponse(events),
    "GET /api/bots": jsonResponse(200, BOTS),
    "GET /api/instances": jsonResponse(200, { instances: [] }),
    "GET /api/routines": jsonResponse(200, { routines: [], runs: [] }),
    "GET /api/companion/endpoints": jsonResponse(200, { serverName: "Ada's Mac", endpoints: [] }),
    "GET /api/threads/t1/messages": jsonResponse(200, page),
    "POST /api/bots/b1/messages": (call: Call) => {
      const body = call.body as { text: string; sendId: string; widgetAction?: unknown };
      if (body.widgetAction) return jsonResponse(202, { ok: true, threadId: "t1", handled: true });
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

test("streams a reply a finished paragraph at a time, then swaps in the saved message", async () => {
  const { events } = await openChat();
  const delta = (eventId: string, piece: string) =>
    events.frame({
      kind: "runtime",
      event: { eventId, provider: "claude", threadId: "t1", createdAt: "", itemId: "i1", type: "content.delta", streamKind: "assistant_text", delta: piece },
    });

  await act(async () => {
    delta("e1", "Jordan usually ");
    delta("e2", "says yes.\n\nAsk for **24");
  });
  expect(await screen.findByText("Jordan usually says yes.")).toBeTruthy();
  expect(screen.getByText("Writing")).toBeTruthy();
  expect(screen.queryByText(/Ask for/)).toBeNull();

  const whole = "Jordan usually says yes.\n\nAsk for **24 months**.";
  await act(async () =>
    events.frame({ kind: "message", threadId: "t1", message: { id: "m5", role: "bot", kind: "text", text: whole, itemId: "i1", at: AT + 5 } }),
  );
  await waitFor(() => expect(screen.queryByText("Writing")).toBeNull());
  expect(screen.getAllByText(whole)).toHaveLength(1);
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

test("scrolled up, an arrow takes the thread back to the latest message", async () => {
  await openChat();
  const thread = screen.getByTestId("thread");
  const scrollTo = (y: number) =>
    fireEvent.scroll(thread, { nativeEvent: { contentOffset: { y }, contentSize: { height: 2000, width: 400 }, layoutMeasurement: { height: 600, width: 400 } } });
  expect(screen.queryByLabelText("Scroll to the latest message")).toBeNull();

  await scrollTo(200);
  await fireEvent.press(screen.getByLabelText("Scroll to the latest message"));
  expect(screen.queryByLabelText("Scroll to the latest message")).toBeNull();

  await scrollTo(1360);
  expect(screen.queryByLabelText("Scroll to the latest message")).toBeNull();
});

test("a send that failed in one chat leaves its error behind when the screen moves to another chat", async () => {
  const events = pushStream();
  const withSecondThread: BotsResponse = {
    ...BOTS,
    bots: [{ ...BOTS.bots[0], tasks: [...(BOTS.bots[0].tasks ?? []), { threadId: "t2", title: "Riftbound", createdAt: AT }] }],
  };
  const desktop = fakeFetch({
    "GET /api/events": streamResponse(events),
    "GET /api/bots": jsonResponse(200, withSecondThread),
    "GET /api/instances": jsonResponse(200, { instances: [] }),
    "GET /api/routines": jsonResponse(200, { routines: [], runs: [] }),
    "GET /api/companion/endpoints": jsonResponse(200, { serverName: "Ada's Mac", endpoints: [] }),
    "GET /api/threads/t1/messages": jsonResponse(200, PAGE),
    "GET /api/threads/t2/messages": jsonResponse(200, {
      messages: [{ id: "n1", role: "bot", kind: "text", text: "It's time to get with Jason.", at: AT }],
      activeLeafId: "n1",
    } satisfies WireMessagePage),
  });
  network.fetch = desktop.fetch;
  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl: "/chat/t1" });
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/events")).toBe(true));
  await act(async () => events.frame({ kind: "hello", cursor: "s:1", resumed: false }));
  expect(await screen.findByText("Here's a draft at $2,450.")).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText("Message"), "Make it 24 months");
  await fireEvent.press(screen.getByLabelText("Send"));
  expect(await screen.findByText(/Couldn't reach Ada's Mac/)).toBeTruthy();

  await act(async () => router.setParams({ id: "t2" }));
  expect(await screen.findByText("It's time to get with Jason.")).toBeTruthy();
  expect(screen.queryByText(/Couldn't reach Ada's Mac/)).toBeNull();
  expect(screen.queryByText("Not sent.")).toBeNull();
});

test("a tap on an image in the chat opens it full screen from the computer, and Close goes back", async () => {
  await openChat();
  expect(screen.getByLabelText("Open chart.png")).toBeTruthy();
  expect(screen.queryByLabelText("Open screen.png")).toBeNull();

  await fireEvent.press(screen.getByLabelText("Open lease.jpg"));
  expect(screen).toHavePathname("/image");
  const image = await screen.findByLabelText("lease.jpg");
  expect(image.props.source).toEqual({ uri: "http://mac.local:8810/api/attachments/lease.jpg", headers: { authorization: "Bearer device-token-1" } });

  await fireEvent.press(screen.getByLabelText("Close image"));
  expect(screen).toHavePathname("/chat/t1");
});

describe("a widget the computer drew, like the daily brief", () => {
  const withBrief: WireMessagePage = { ...PAGE, messages: [...PAGE.messages, BRIEF_MESSAGE], activeLeafId: "w1" };
  const opened = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  beforeEach(() => opened.mockClear());

  test("shows as a card with its sections and buttons, not its text fallback", async () => {
    await openChat(withBrief);
    expect(screen.getByText("Your brief")).toBeTruthy();
    expect(screen.getByText("Thursday, November 19")).toBeTruthy();
    expect(screen.getByText("Important emails")).toBeTruthy();
    expect(screen.getByText("Asks you to define.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draft a reply to McKnight, Riley M" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss McKnight, Riley M's email" })).toBeTruthy();
    expect(screen.queryByText(/\[Draft a reply/)).toBeNull();
  });

  test("a button the computer answers is sent as a press on that widget", async () => {
    const { desktop } = await openChat(withBrief);
    await fireEvent.press(screen.getByText("Draft a reply to McKnight, Riley M"));
    await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/bots/b1/messages")).toBe(true));
    expect(desktop.calls.find((call) => call.path === "/api/bots/b1/messages")?.body).toEqual({
      threadId: "t1",
      sendId: expect.stringMatching(/^uuid-/),
      widgetAction: { messageId: "w1", ref: "n8", rev: 2 },
    });
  });

  test("Open in Gmail opens the link on the phone and sends nothing", async () => {
    const { desktop } = await openChat(withBrief);
    await fireEvent.press(screen.getByText("Open in Gmail"));
    expect(opened).toHaveBeenCalledWith("https://mail.google.com/mail/#all/g1");
    expect(desktop.calls.some((call) => call.method === "POST")).toBe(false);
  });

  test("Open on a routine opens its chat", async () => {
    await openChat(withBrief);
    await fireEvent.press(screen.getByText("Open"));
    expect(screen).toHavePathname("/chat/t2");
  });

  test("a press the computer refuses shows its reason on the card", async () => {
    const events = pushStream();
    const desktop = fakeFetch({
      "GET /api/events": streamResponse(events),
      "GET /api/bots": jsonResponse(200, BOTS),
      "GET /api/instances": jsonResponse(200, { instances: [] }),
      "GET /api/routines": jsonResponse(200, { routines: [], runs: [] }),
      "GET /api/companion/endpoints": jsonResponse(200, { serverName: "Ada's Mac", endpoints: [] }),
      "GET /api/threads/t1/messages": jsonResponse(200, withBrief),
      "POST /api/bots/b1/messages": jsonResponse(409, { error: "This was already answered." }),
    });
    network.fetch = desktop.fetch;
    await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl: "/chat/t1" });
    await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/events")).toBe(true));
    await act(async () => events.frame({ kind: "hello", cursor: "s:1", resumed: false }));
    await fireEvent.press(await screen.findByText("Dismiss McKnight, Riley M's email"));
    expect(await screen.findByText("This was already answered.")).toBeTruthy();
  });
});
