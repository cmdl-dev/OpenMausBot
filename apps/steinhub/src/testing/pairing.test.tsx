import type { BotsResponse, PairResponse } from "@openmausbot/phone-protocol/responses.ts";
import { Stack } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { fakeFetch, jsonResponse, pushStream, streamResponse } from "@/testing/fake-desktop";
import { network, secureValues } from "@/testing/native-mocks";

jest.mock("expo-secure-store", () => jest.requireActual("@/testing/native-mocks").secureStore);
jest.mock("expo-crypto", () => jest.requireActual("@/testing/native-mocks").crypto);
jest.mock("expo-camera", () => jest.requireActual("@/testing/native-mocks").camera);
jest.mock("expo/fetch", () => ({ fetch: (...args: unknown[]) => jest.requireActual("@/testing/native-mocks").network.fetch(...args) }));

function DrawerWithoutAnimation() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

const PAIRED: PairResponse = {
  token: "device-token-1",
  device: { id: "d1", name: "SteinHub phone", createdAt: 1, lastSeenAt: 1 },
  serverName: "Ada's Mac",
};

const BOTS: BotsResponse = {
  bots: [
    {
      id: "b1",
      threadId: "t1",
      name: "Scout",
      title: "Research",
      description: "",
      notifications: true,
      color: "green",
      avatarUrl: null,
      unread: false,
      modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
      createdAt: 1,
      tasks: [],
      messages: [],
      activeLeafId: null,
    },
  ],
  botQueuedMessages: {},
  sections: [],
  groups: [],
  computerControl: {},
};

beforeEach(() => {
  secureValues.clear();
  secureValues.set("steinhub.demo", "off");
});

test("pairs with a typed address and six-digit code, stores the token, and opens on the computer's bots", async () => {
  const events = pushStream();
  const desktop = fakeFetch({
    "POST http://mac.local:8810/api/pair": jsonResponse(201, PAIRED),
    "GET /api/events": streamResponse(events),
    "GET /api/bots": jsonResponse(200, BOTS),
    "GET /api/instances": jsonResponse(200, { instances: [] }),
    "GET /api/routines": jsonResponse(200, { routines: [], runs: [] }),
    "GET /api/companion/endpoints": jsonResponse(200, { serverName: "Ada's Mac", endpoints: [], version: "0.1.161" }),
  });
  network.fetch = desktop.fetch;

  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl: "/onboarding" });

  await fireEvent.press(await screen.findByText("Enter code manually"));
  await fireEvent.changeText(screen.getByLabelText("Computer address"), "mac.local");
  await fireEvent.changeText(screen.getByLabelText("Pairing code"), "482 913");
  await fireEvent.press(screen.getByText("Continue"));

  expect(await screen.findByText("mac.local")).toBeTruthy();
  await fireEvent.press(screen.getByText("Pair"));

  await waitFor(() => expect(screen).toHavePathname("/"));
  const pairCall = desktop.calls.find((call) => call.path === "/api/pair");
  expect(pairCall?.body).toMatchObject({ credential: "482913", deviceName: expect.any(String) });
  expect(pairCall?.headers.authorization).toBeUndefined();
  expect(JSON.parse(secureValues.get("steinhub.session") ?? "{}")).toMatchObject({
    token: "device-token-1",
    urls: ["http://mac.local:8810"],
    serverName: "Ada's Mac",
  });

  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/events")).toBe(true));
  expect(desktop.calls.find((call) => call.path === "/api/events")?.headers.authorization).toBe("Bearer device-token-1");
  await act(async () => events.frame({ kind: "hello", cursor: "s:1", resumed: false }));
  expect(await screen.findByLabelText("Switch bot, Scout")).toBeTruthy();
});

test("a wrong code is explained on the confirm step and can be tried again", async () => {
  network.fetch = fakeFetch({
    "POST /api/pair": jsonResponse(401, { error: "wrong code", code: "pairing_code_wrong" }),
  }).fetch;

  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl: "/onboarding" });
  await fireEvent.press(await screen.findByText("Enter code manually"));
  await fireEvent.changeText(screen.getByLabelText("Computer address"), "mac.local:8810");
  await fireEvent.changeText(screen.getByLabelText("Pairing code"), "000000");
  await fireEvent.press(screen.getByText("Continue"));
  await fireEvent.press(await screen.findByText("Pair"));

  expect(await screen.findByText("That code didn't match. Check the six digits on the computer and try again.")).toBeTruthy();
  expect(screen.getByText("Try again")).toBeTruthy();
  expect(secureValues.has("steinhub.session")).toBe(false);
});

test("a server's 12-character code is explained before anything is sent", async () => {
  const desktop = fakeFetch({});
  network.fetch = desktop.fetch;
  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl: "/onboarding" });
  await fireEvent.press(await screen.findByText("Enter code manually"));
  await fireEvent.changeText(screen.getByLabelText("Computer address"), "mac.local");
  await fireEvent.changeText(screen.getByLabelText("Pairing code"), "7KQ2-M9XD-H4TP");
  await fireEvent.press(screen.getByText("Continue"));
  expect(await screen.findByText(/That code is for a server or a Cloud/)).toBeTruthy();
  expect(desktop.calls).toHaveLength(0);
});
