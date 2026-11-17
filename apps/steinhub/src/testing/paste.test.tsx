import type { BotsResponse } from "@openmausbot/phone-protocol/responses.ts";
import { Stack } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import type { Session } from "@/api/session";
import { fakeFetch, jsonResponse, pushStream, streamResponse } from "@/testing/fake-desktop";
import { network, secureValues } from "@/testing/native-mocks";

jest.mock("expo-secure-store", () => jest.requireActual("@/testing/native-mocks").secureStore);
jest.mock("expo-crypto", () => jest.requireActual("@/testing/native-mocks").crypto);
jest.mock("expo-camera", () => jest.requireActual("@/testing/native-mocks").camera);
jest.mock("expo/fetch", () => ({ fetch: (...args: unknown[]) => jest.requireActual("@/testing/native-mocks").network.fetch(...args) }));

const mockWritten = new Map<string, Uint8Array>();
jest.mock("expo-file-system", () => {
  class File {
    uri: string;
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
    }
    async write(content: string) {
      mockWritten.set(this.uri, Uint8Array.from(atob(content), (ch) => ch.charCodeAt(0)));
    }
    async bytes() {
      return mockWritten.get(this.uri) ?? new Uint8Array();
    }
  }
  return { File, Paths: { cache: { uri: "file:///cache" } } };
});

const mockClipboard = { hasImage: true, listeners: [] as Array<() => void>, reads: 0 };
jest.mock("expo-clipboard", () => ({
  isPasteButtonAvailable: false,
  hasImageAsync: async () => mockClipboard.hasImage,
  getImageAsync: async () => {
    mockClipboard.reads++;
    return mockClipboard.hasImage ? { data: `data:image/jpeg;base64,${btoa("fake-jpeg")}`, size: { width: 2, height: 2 } } : null;
  },
  addClipboardListener: (listener: () => void) => {
    mockClipboard.listeners.push(listener);
    return { remove: () => {} };
  },
  ClipboardPasteButton: () => null,
  setStringAsync: async () => true,
}));

function DrawerWithoutAnimation() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

const SESSION: Session = {
  token: "device-token-1",
  urls: ["http://mac.local:8810"],
  serverName: "Ada's Mac",
  device: { id: "d1", name: "Test iPhone", createdAt: 1, lastSeenAt: 1 },
  pairedAt: 1,
};

const SCOUT = {
  id: "b2",
  name: "Scout",
  title: "",
  description: "",
  notifications: true,
  color: "purple",
  avatarUrl: null,
  unread: false,
  modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
  createdAt: 1,
  tasks: [],
  messages: [],
  activeLeafId: null,
} as unknown as BotsResponse["bots"][number];

test("an image on the clipboard pastes into the message from Paste image, and goes up to the computer", async () => {
  secureValues.clear();
  secureValues.set("steinhub.demo", "off");
  secureValues.set("steinhub.session", JSON.stringify(SESSION));
  const events = pushStream();
  const desktop = fakeFetch({
    "GET /api/events": streamResponse(events),
    "GET /api/bots": jsonResponse(200, { bots: [SCOUT], botQueuedMessages: {}, sections: [], groups: [], computerControl: {} } as BotsResponse),
    "GET /api/instances": jsonResponse(200, { instances: [] }),
    "GET /api/routines": jsonResponse(200, { routines: [], runs: [] }),
    "GET /api/companion/endpoints": jsonResponse(200, { serverName: "Ada's Mac", endpoints: [] }),
    "GET /api/inbox": jsonResponse(404, { error: "not found" }),
    "POST /api/attachments": jsonResponse(200, { path: "/api/attachments/pasted.jpg", mime: "image/jpeg", bytes: 9 }),
  });
  network.fetch = desktop.fetch;
  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl: "/" });
  await act(async () => events.frame({ kind: "hello", cursor: "s:1", resumed: false }));
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/bots")).toBe(true));

  const field = await screen.findByLabelText("Message");
  expect(screen.queryByLabelText("Paste image")).toBeNull();
  await fireEvent(field, "focus");
  await fireEvent.press(await screen.findByLabelText("Paste image"));

  await waitFor(() => expect(desktop.calls.some((call) => call.method === "POST" && call.path === "/api/attachments")).toBe(true));
  const upload = desktop.calls.find((call) => call.path === "/api/attachments")!;
  expect(new TextDecoder().decode(upload.body as Uint8Array)).toBe("fake-jpeg");
  expect(await screen.findByLabelText(/^Remove pasted-\d+\.jpg$/)).toBeTruthy();
  expect(screen.queryByLabelText("Paste image")).toBeNull();

  await act(async () => mockClipboard.listeners.forEach((listener) => listener()));
  expect(await screen.findByLabelText("Paste image")).toBeTruthy();
});
