import type { BotsResponse, WireMessagePage } from "@openmausbot/phone-protocol/responses.ts";
import type { WireMessage } from "@openmausbot/phone-protocol/wire.ts";
import { Stack } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import type { Session } from "@/api/session";
import { fakeFetch, jsonResponse, pushStream, streamResponse, type Call, type PushStream } from "@/testing/fake-desktop";
import { network, secureValues } from "@/testing/native-mocks";

jest.mock("expo-secure-store", () => jest.requireActual("@/testing/native-mocks").secureStore);
jest.mock("expo-crypto", () => jest.requireActual("@/testing/native-mocks").crypto);
jest.mock("expo-camera", () => jest.requireActual("@/testing/native-mocks").camera);
// Reanimated 4.7's jest build can't run a GestureDetector; the page's gestures are left out here.
jest.mock("react-native-gesture-handler", () => ({
  ...jest.requireActual("react-native-gesture-handler"),
  GestureDetector: ({ children }: { children: unknown }) => children,
  useTapGesture: () => ({}),
  usePanGesture: () => ({}),
  usePinchGesture: () => ({}),
  useSimultaneousGestures: () => ({}),
}));
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
      tasks: [{ threadId: "t1", title: "Phone bill", createdAt: AT }],
      messages: [],
      activeLeafId: null,
    },
  ],
  botQueuedMessages: {},
  sections: [],
  groups: [],
  computerControl: {},
};

function signInMessage(state: Partial<NonNullable<WireMessage["signIn"]>> = {}): WireMessage {
  return {
    id: "s1",
    role: "bot",
    kind: "signin",
    at: AT + 1,
    text: "MausBot needs you to sign in to account.speedtalkmobile.com. Open this conversation in OpenMausBot to sign in, then press Done.",
    signIn: { url: "https://account.speedtalkmobile.com/login", site: "account.speedtalkmobile.com", place: "browser", reason: "To check the bill", ...state },
  };
}

function page(message: WireMessage): WireMessagePage {
  return {
    messages: [{ id: "m1", role: "user", kind: "text", text: "Pay my phone bill", at: AT }, message],
    activeLeafId: message.id,
  };
}

/** The computer's side: its events, a browser view to write into, and every call the phone made. */
async function openApp(url: string, message: WireMessage = signInMessage()) {
  const events = pushStream();
  const browser: { stream: PushStream | null } = { stream: null };
  const desktop = fakeFetch({
    "GET /api/events": streamResponse(events),
    "GET /api/bots": jsonResponse(200, BOTS),
    "GET /api/instances": jsonResponse(200, { instances: [] }),
    "GET /api/routines": jsonResponse(200, { routines: [], runs: [] }),
    "GET /api/companion/endpoints": jsonResponse(200, { serverName: "Ada's Mac", endpoints: [] }),
    "GET /api/threads/t1/messages": jsonResponse(200, page(message)),
    "GET /api/bots/b1/browser/live": () => {
      browser.stream = pushStream();
      return streamResponse(browser.stream);
    },
    "POST /api/bots/b1/browser/action": jsonResponse(200, { ok: true }),
    "POST /api/bots/b1/sign-in-cards/s1/done": jsonResponse(200, { ok: true }),
    "POST /api/bots/b1/sign-in-cards/s1/cancel": jsonResponse(200, { ok: true }),
  });
  network.fetch = desktop.fetch;
  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl: url });
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/events")).toBe(true));
  await act(async () => events.frame({ kind: "hello", cursor: "s:1", resumed: false }));
  return { desktop, browser };
}

function send(stream: PushStream | null, type: string, data: object) {
  stream?.send(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

const FRAME = {
  seq: 1,
  data: "AAAA",
  format: "jpeg",
  metadata: { deviceWidth: 1280, deviceHeight: 2240, offsetTop: 0, pageScaleFactor: 1, scrollOffsetX: 0, scrollOffsetY: 0, timestamp: 1 },
};

const actions = (calls: Call[]) => calls.filter((call) => call.path === "/api/bots/b1/browser/action").map((call) => call.body);

beforeEach(() => {
  secureValues.clear();
  secureValues.set("steinhub.demo", "off");
  secureValues.set("steinhub.session", JSON.stringify(SESSION));
});

test("a sign-in request shows as a card; Cancel answers it", async () => {
  const { desktop } = await openApp("/chat/t1");
  expect(await screen.findByText("MausBot needs you to sign in to account.speedtalkmobile.com")).toBeTruthy();
  expect(screen.getByText("To check the bill")).toBeTruthy();
  expect(screen.queryByText(/Open this conversation in OpenMausBot/)).toBeNull();

  await fireEvent.press(screen.getByText("Cancel"));
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/bots/b1/sign-in-cards/s1/cancel")).toBe(true));
  expect(desktop.calls.find((call) => call.path.endsWith("/cancel"))?.body).toEqual({ threadId: "t1" });
});

test("a settled card says how it ended", async () => {
  await openApp("/chat/t1", signInMessage({ done: true, resumed: true }));
  expect(await screen.findByText("Signed in to account.speedtalkmobile.com · MausBot is continuing")).toBeTruthy();
  expect(screen.queryByText("Open")).toBeNull();
});

test("Open shows the bot's browser in your control on the site, and Give back tells the bot you're done", async () => {
  const { desktop, browser } = await openApp("/chat/t1");
  await fireEvent.press(await screen.findByText("Open"));
  await waitFor(() => expect(browser.stream).not.toBeNull());
  const live = desktop.calls.find((call) => call.path === "/api/bots/b1/browser/live");
  expect(new URL(live!.url).searchParams.toString()).toBe("threadId=t1");

  await act(async () => {
    send(browser.stream, "ready", { viewerId: "v1" });
    send(browser.stream, "control", { held: true, owned: true, controlling: false });
    send(browser.stream, "url", { url: "about:blank" });
    send(browser.stream, "frame", FRAME);
  });
  await waitFor(() => expect(actions(desktop.calls)).toContainEqual({ type: "take", viewerId: "v1" }));
  expect(actions(desktop.calls)).toContainEqual({ type: "ack", seq: 1, viewerId: "v1" });

  await act(async () => send(browser.stream, "control", { held: true, owned: true, controlling: true }));
  await waitFor(() =>
    expect(actions(desktop.calls)).toContainEqual({ type: "navigate", url: "https://account.speedtalkmobile.com/login", viewerId: "v1" }),
  );

  await fireEvent.press(screen.getByText("Give back"));
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/bots/b1/sign-in-cards/s1/done")).toBe(true));
  expect(actions(desktop.calls).some((action) => (action as { type: string }).type === "release")).toBe(false);
});

test("typing goes to the page: letters as text, Backspace and Enter as keys", async () => {
  const { desktop, browser } = await openApp("/browser?bot=b1&thread=t1");
  await waitFor(() => expect(browser.stream).not.toBeNull());
  await act(async () => {
    send(browser.stream, "ready", { viewerId: "v1" });
    send(browser.stream, "control", { held: true, owned: true, controlling: true });
  });
  const keys = await screen.findByLabelText("Type into the page");
  await fireEvent.changeText(keys, "\u200ba");
  await fireEvent.changeText(keys, "");
  await fireEvent(keys, "submitEditing");

  await waitFor(() => expect(actions(desktop.calls).filter((action) => (action as { type: string }).type === "input_keyboard")).toHaveLength(5));
  expect(actions(desktop.calls).filter((action) => (action as { type: string }).type === "input_keyboard")).toEqual([
    { type: "input_keyboard", eventType: "char", text: "a", viewerId: "v1" },
    { type: "input_keyboard", eventType: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, viewerId: "v1" },
    { type: "input_keyboard", eventType: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, viewerId: "v1" },
    { type: "input_keyboard", eventType: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", viewerId: "v1" },
    { type: "input_keyboard", eventType: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, viewerId: "v1" },
  ]);
});

test("from the bot's page: watch, Take control, then Give back hands the browser back", async () => {
  const { desktop, browser } = await openApp("/bot/b1");
  await fireEvent.press(await screen.findByText("Browser"));
  await waitFor(() => expect(browser.stream).not.toBeNull());
  await act(async () => {
    send(browser.stream, "ready", { viewerId: "v1" });
    send(browser.stream, "control", { held: false, owned: false, controlling: false });
  });
  expect(await screen.findByText("MausBot has the browser.")).toBeTruthy();
  expect(actions(desktop.calls).some((action) => (action as { type: string }).type === "take")).toBe(false);

  await fireEvent.press(screen.getByText("Take control"));
  await waitFor(() => expect(actions(desktop.calls)).toContainEqual({ type: "take", viewerId: "v1" }));
  await act(async () => send(browser.stream, "control", { held: true, owned: true, controlling: true }));
  await fireEvent.press(await screen.findByText("Give back"));
  await waitFor(() => expect(actions(desktop.calls)).toContainEqual({ type: "release", viewerId: "v1" }));
});

test("someone else holding the browser leaves only watching", async () => {
  const { browser } = await openApp("/browser?bot=b1&thread=t1");
  await waitFor(() => expect(browser.stream).not.toBeNull());
  await act(async () => {
    send(browser.stream, "ready", { viewerId: "v1" });
    send(browser.stream, "control", { held: true, owned: false, controlling: false });
  });
  expect(await screen.findByText("Someone else is using this browser.")).toBeTruthy();
  expect(screen.queryByText("Take control")).toBeNull();
});

test("a browser that went to sleep offers to open it again", async () => {
  const { desktop, browser } = await openApp("/browser?bot=b1&thread=t1");
  await waitFor(() => expect(browser.stream).not.toBeNull());
  await act(async () => send(browser.stream, "error", { retryable: false, asleep: true, message: "This browser closed after it sat unused." }));
  await fireEvent.press(await screen.findByText("Open it again"));
  await waitFor(() => expect(desktop.calls.filter((call) => call.path === "/api/bots/b1/browser/live")).toHaveLength(2));
});
