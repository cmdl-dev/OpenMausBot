import type { BotsResponse, InstancesResponse } from "@openmausbot/phone-protocol/responses.ts";
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

const SESSION: Session = {
  token: "device-token-1",
  urls: ["http://mac.local:8810"],
  serverName: "Ada's Mac",
  device: { id: "d1", name: "Test iPhone", createdAt: 1, lastSeenAt: 1 },
  pairedAt: 1,
};

const BOT = {
  id: "b1", threadId: "t1", name: "MausBot", title: "Chief of Staff", description: "", notifications: true, color: "purple",
  avatarUrl: null, unread: false, modelSelection: { instanceId: "codex", model: "gpt-6.1-sol" }, createdAt: 1, tasks: [],
  messages: [], activeLeafId: null,
} as BotsResponse["bots"][number];

const BOTS: BotsResponse = { bots: [BOT], botQueuedMessages: {}, sections: [], groups: [], computerControl: {} };

const INSTANCES: InstancesResponse = {
  instances: [
    { instanceId: "codex", driverKind: "codex", displayName: "Codex", snapshot: { state: "available" }, models: { default: "gpt-6.1-sol", options: [{ id: "gpt-6.1-sol", label: "GPT 6.1 Sol" }] } },
    { instanceId: "claude", driverKind: "claude", displayName: "Claude", snapshot: { state: "available" }, models: { default: "claude-opus-5-5", options: [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }] } },
    { instanceId: "grok", driverKind: "grok", displayName: "Grok", snapshot: { state: "unavailable", reason: "grok isn't installed" }, models: { default: "grok-4.7", options: [{ id: "grok-4.7", label: "Grok 4.7" }] } },
  ],
} as InstancesResponse;

test("Model opens the computer's engines, and a pick changes the bot's model", async () => {
  const events = pushStream();
  const desktop = fakeFetch({
    "GET /api/events": streamResponse(events),
    "GET /api/bots": jsonResponse(200, BOTS),
    "GET /api/instances": jsonResponse(200, INSTANCES),
    "GET /api/routines": jsonResponse(200, { routines: [], runs: [] }),
    "GET /api/companion/endpoints": jsonResponse(200, { serverName: "Ada's Mac", endpoints: [] }),
    "PATCH /api/bots/b1": (call: Call) =>
      jsonResponse(200, { bot: { ...BOT, modelSelection: (call.body as { modelSelection: typeof BOT.modelSelection }).modelSelection } }),
  });
  secureValues.clear();
  secureValues.set("steinhub.demo", "off");
  secureValues.set("steinhub.session", JSON.stringify(SESSION));
  network.fetch = desktop.fetch;
  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl: "/bot/b1" });
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/events")).toBe(true));
  await act(async () => events.frame({ kind: "hello", cursor: "s:1", resumed: false }));

  await fireEvent.press(await screen.findByText("Model"));
  expect(await screen.findByText("Claude Opus 5.5")).toBeTruthy();
  expect(screen.queryByText("Grok 4.7")).toBeNull();
  expect(screen.getByText("Not set up on Ada's Mac: Grok.")).toBeTruthy();

  await fireEvent.press(screen.getByText("Claude Opus 5.5"));
  await waitFor(() =>
    expect(desktop.calls.find((call) => call.method === "PATCH" && call.path === "/api/bots/b1")?.body).toEqual({
      modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
      requireAvailableModel: true,
    }),
  );
  await waitFor(() => expect(screen.getAllByText("Claude Opus 5.5").length).toBeGreaterThan(0));
});
