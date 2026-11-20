import type { BotsResponse } from "@openmausbot/phone-protocol/responses.ts";
import type { CallDetail } from "@openmausbot/phone-protocol/phone-calls.ts";
import { Stack } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import type { Session } from "@/api/session";
import { fakeFetch, jsonResponse, pushStream, streamResponse } from "@/testing/fake-desktop";
import { network, secureValues } from "@/testing/native-mocks";

jest.mock("expo-secure-store", () => jest.requireActual("@/testing/native-mocks").secureStore);
jest.mock("expo-crypto", () => jest.requireActual("@/testing/native-mocks").crypto);
jest.mock("expo-camera", () => jest.requireActual("@/testing/native-mocks").camera);
jest.mock("expo/fetch", () => ({ fetch: (...args: unknown[]) => jest.requireActual("@/testing/native-mocks").network.fetch(...args) }));

const mockFiles = { downloads: [] as Array<{ url: string; to: string; headers: unknown }>, fail: null as string | null, previews: [] as unknown[] };
jest.mock("expo-file-system", () => {
  class File {
    uri: string;
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
    }
    async preview(options: unknown) {
      mockFiles.previews.push({ uri: this.uri, ...(options as object) });
    }
    static async downloadFileAsync(url: string, to: File, options: { headers: unknown }) {
      mockFiles.downloads.push({ url, to: to.uri, headers: options.headers });
      if (mockFiles.fail) throw new Error(mockFiles.fail);
      return to;
    }
  }
  return { File, Paths: { cache: { uri: "file:///cache" } } };
});

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

const AT = Date.UTC(2026, 10, 15, 17, 2);
const CALL: CallDetail = {
  id: "c-1",
  botId: "b1",
  botName: "Scout",
  threadId: "t1",
  to: "+14155550123",
  calleeName: "Bright Smile Dental",
  goal: "Move the cleaning.",
  brief: "Move the cleaning.",
  phase: "ended",
  createdAt: AT,
  answeredAt: AT + 8_000,
  endedAt: AT + 102_000,
  endReason: "completed",
  seconds: 94,
  lines: 1,
  recorded: true,
  transcript: [{ speaker: "callee", text: "Bright Smile Dental, this is Dana.", at: AT + 10_000 }],
  recording: { path: "/data/calls/c-1.wav", bytes: 1_504_044, seconds: 94, url: "/api/calls/c-1/recording" },
};

async function openCall(call: CallDetail) {
  secureValues.clear();
  secureValues.set("steinhub.demo", "off");
  secureValues.set("steinhub.session", JSON.stringify(SESSION));
  const events = pushStream();
  network.fetch = fakeFetch({
    "GET /api/events": streamResponse(events),
    "GET /api/bots": jsonResponse(200, { bots: [], botQueuedMessages: {}, sections: [], groups: [], computerControl: {} } as unknown as BotsResponse),
    "GET /api/instances": jsonResponse(200, { instances: [] }),
    "GET /api/routines": jsonResponse(200, { routines: [], runs: [] }),
    "GET /api/companion/endpoints": jsonResponse(200, { serverName: "Ada's Mac", endpoints: [] }),
    "GET /api/inbox": jsonResponse(404, { error: "not found" }),
    "GET /api/calls/c-1": jsonResponse(200, call),
  }).fetch;
  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl: "/calls/c-1" });
  await act(async () => events.frame({ kind: "hello", cursor: "s:1", resumed: false }));
  await screen.findByText("Bright Smile Dental, this is Dana.");
}

beforeEach(() => {
  mockFiles.downloads = [];
  mockFiles.previews = [];
  mockFiles.fail = null;
});

test("a recorded call opens its recording in the phone's player, fetched with this phone's token", async () => {
  await openCall(CALL);
  expect(screen.getByText("1:34 · 1.4 MB")).toBeTruthy();
  await fireEvent.press(screen.getByText("Open recording"));
  await waitFor(() => expect(mockFiles.previews).toHaveLength(1));
  expect(mockFiles.downloads).toEqual([
    { url: "http://mac.local:8810/api/calls/c-1/recording", to: "file:///cache/c-1.wav", headers: { authorization: "Bearer device-token-1" } },
  ]);
  expect(mockFiles.previews[0]).toEqual({ uri: "file:///cache/c-1.wav", title: "Call with Bright Smile Dental", mimeType: "audio/wav" });
});

test("a recording the computer no longer has says so instead of opening", async () => {
  await openCall(CALL);
  mockFiles.fail = "response has status 404";
  await fireEvent.press(screen.getByText("Open recording"));
  expect(await screen.findByText("Recording unavailable. It's no longer on the computer.")).toBeTruthy();
  expect(screen.queryByText("Open recording")).toBeNull();
  expect(mockFiles.previews).toHaveLength(0);
});

test("a call without a recording shows no recording", async () => {
  await openCall({ ...CALL, recorded: undefined, recording: undefined });
  expect(screen.queryByText("Open recording")).toBeNull();
  expect(screen.queryByText("Recording")).toBeNull();
});
