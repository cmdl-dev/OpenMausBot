import type { BotsResponse } from "@openmausbot/phone-protocol/responses.ts";
import { Stack } from "expo-router";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Linking } from "react-native";
import type { AppCatalogReply, AppConnectionsReply } from "@/api/client";
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

const BOTS: BotsResponse = { bots: [], botQueuedMessages: {}, sections: [], groups: [], computerControl: {} };

const CATALOG: AppCatalogReply = {
  configured: true,
  cards: [
    { slug: "gmail", label: "Gmail", blurb: "Email from Google.", logo: null, categories: ["email"] },
    { slug: "notion", label: "Notion", blurb: "Notes and docs.", logo: null, categories: ["productivity"] },
    { slug: "github", label: "GitHub", blurb: "Code hosting.", logo: null, categories: ["developer tools"] },
  ],
};

const CONNECTED: AppConnectionsReply = {
  configured: true,
  services: { gmail: { connected: true, accounts: [{ id: "ca_1", alias: "Business", status: "ACTIVE" }] } },
};

async function openApps() {
  const desktop = fakeFetch({
    "GET /api/events": streamResponse(pushStream()),
    "GET /api/bots": jsonResponse(200, BOTS),
    "GET /api/instances": jsonResponse(200, { instances: [] }),
    "GET /api/routines": jsonResponse(200, { routines: [], runs: [] }),
    "GET /api/companion/endpoints": jsonResponse(200, { serverName: "Ada's Mac", endpoints: [] }),
    "GET /api/connectors/catalog": jsonResponse(200, CATALOG),
    "GET /api/connectors/connected": jsonResponse(200, CONNECTED),
    "GET /api/connectors": jsonResponse(200, CONNECTED),
    "POST /api/connectors/notion/authorize": jsonResponse(200, { url: "https://connect.example.com/notion" }),
    "POST /api/connectors/gmail/authorize": (call: Call) => jsonResponse(200, { url: `https://connect.example.com/gmail?alias=${(call.body as { alias: string }).alias}` }),
  });
  network.fetch = desktop.fetch;
  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl: "/apps" });
  expect(await screen.findByText("Notion")).toBeTruthy();
  return desktop;
}

const opened = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);

beforeEach(() => {
  secureValues.clear();
  secureValues.set("steinhub.demo", "off");
  secureValues.set("steinhub.session", JSON.stringify(SESSION));
  opened.mockClear();
});

test("lists the connected apps with their accounts, then the apps that can be added", async () => {
  await openApps();
  expect(screen.getByText("Connected")).toBeTruthy();
  expect(screen.getByText("Business")).toBeTruthy();
  expect(screen.getByText("Add an app")).toBeTruthy();
  expect(screen.getByText("GitHub")).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText("Search apps"), "developer");
  expect(screen.getByText("GitHub")).toBeTruthy();
  expect(screen.queryByText("Notion")).toBeNull();
  expect(screen.getByText("Results")).toBeTruthy();
});

test("Connect starts the sign-in on the computer and opens its page", async () => {
  const desktop = await openApps();
  await fireEvent.press(screen.getAllByText("Connect")[0]!);
  await waitFor(() => expect(opened).toHaveBeenCalledWith("https://connect.example.com/notion"));
  expect(desktop.calls.find((call) => call.path === "/api/connectors/notion/authorize")?.headers.authorization).toBe("Bearer device-token-1");
  expect(await screen.findByText("Finish signing in on the page that opened, then come back.")).toBeTruthy();
});

test("a second account for a connected app is named before its sign-in starts", async () => {
  const desktop = await openApps();
  await fireEvent.press(screen.getByText("Add account"));
  await fireEvent.changeText(screen.getByLabelText("Name for the new Gmail account"), "Personal");
  await fireEvent.press(screen.getAllByText("Connect")[0]!);
  await waitFor(() => expect(opened).toHaveBeenCalledWith("https://connect.example.com/gmail?alias=Personal"));
  expect(desktop.calls.find((call) => call.path === "/api/connectors/gmail/authorize")?.body).toEqual({ alias: "Personal" });
});
