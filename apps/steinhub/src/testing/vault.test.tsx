import type { BotsResponse } from "@openmausbot/phone-protocol/responses.ts";
import { Stack } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Alert } from "react-native";
import type { VaultReply } from "@/api/client";
import type { Session } from "@/api/session";
import { fakeFetch, jsonResponse, pushStream, streamResponse } from "@/testing/fake-desktop";
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

type WireBot = BotsResponse["bots"][number];
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
} as unknown as WireBot;

// The networks' published test card numbers: nobody's real card.
const VAULT: VaultReply = {
  logins: [{ id: "l1", site: "zillow.com", hosts: ["zillow.com"], username: "ada@example.com", hasTotp: true, source: "settings", bots: "all" }],
  secrets: [
    { id: "s1", name: "Stripe secret key", source: "settings", bots: ["b2"] },
    { id: "s2", name: "Notion token", source: "linked", provider: "1password", bots: "all" },
  ],
  cards: [{ id: "c1", name: "", brand: "visa", last4: "4242", expMonth: 8, expYear: 2029, hasCvc: true, bots: "all", createdAt: 1, updatedAt: 1 }],
};

async function openPaired(initialUrl: string, routes: Parameters<typeof fakeFetch>[0] = {}) {
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
    "GET /api/vault": jsonResponse(200, VAULT),
    ...routes,
  });
  network.fetch = desktop.fetch;
  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl });
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/events")).toBe(true));
  await act(async () => events.frame({ kind: "hello", cursor: "s:1", resumed: false }));
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/bots")).toBe(true));
  return desktop;
}

afterEach(() => jest.restoreAllMocks());

test("Settings opens the Vault, which lists logins, secrets and cards by name and filters them", async () => {
  await openPaired("/settings");
  await fireEvent.press(await screen.findByText("Vault"));
  expect(screen).toHavePathname("/vault");
  expect(await screen.findByText("zillow.com")).toBeTruthy();
  expect(screen.getByText("ada@example.com · 2FA")).toBeTruthy();
  expect(screen.getByText("Stripe secret key")).toBeTruthy();
  expect(screen.getByText("From 1Password")).toBeTruthy();
  expect(screen.getByText("Visa ending 4242 · Expires 08/29")).toBeTruthy();

  await fireEvent.press(screen.getByRole("button", { name: /^Cards/ }));
  expect(screen.queryByText("zillow.com")).toBeNull();
  expect(screen.getByText("Visa ending 4242")).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText("Search the Vault"), "nothing like it");
  expect(screen.getByText("Nothing matches your search.")).toBeTruthy();
});

test("a card is checked before it is sent, then sent once to the computer's Vault", async () => {
  const desktop = await openPaired("/vault/add?kind=card", { "POST /api/vault/cards": jsonResponse(201, { card: VAULT.cards![0] }) });
  await fireEvent.changeText(await screen.findByLabelText("Card number"), "4242424242424241");
  await fireEvent.changeText(screen.getByLabelText("Expiry"), "0829");
  await fireEvent.changeText(screen.getByLabelText("Security code"), "737");
  await fireEvent.press(screen.getByText("Save to Vault"));
  expect(screen.getByText(/That one doesn't look right/)).toBeTruthy();
  expect(desktop.calls.some((call) => call.method === "POST")).toBe(false);

  await fireEvent.changeText(screen.getByLabelText("Card number"), "4242424242424242");
  expect(screen.getByLabelText("Card number").props.value).toBe("4242 4242 4242 4242");
  expect(screen.getByLabelText("Expiry").props.value).toBe("08/29");
  await fireEvent.press(screen.getByText("Scout"));
  await fireEvent.press(screen.getByText("Save to Vault"));
  await waitFor(() => expect(desktop.calls.some((call) => call.method === "POST" && call.path === "/api/vault/cards")).toBe(true));
  const sent = desktop.calls.find((call) => call.method === "POST")!;
  expect(sent.body).toEqual({ name: "", number: "4242424242424242", expMonth: 8, expYear: 2029, cvc: "737", bots: ["b2"] });
});

test("a login goes to the Vault's logins, and the form hands back to the Vault", async () => {
  const desktop = await openPaired("/vault/add?kind=login", { "POST /api/logins": jsonResponse(201, { login: VAULT.logins[0] }) });
  await fireEvent.changeText(await screen.findByLabelText("Website"), "zillow.com");
  await fireEvent.changeText(screen.getByLabelText("Username or email"), "ada@example.com");
  await fireEvent.changeText(screen.getByLabelText("Password"), "fake-test-pass");
  await fireEvent.press(screen.getByText("Save to Vault"));
  await waitFor(() => expect(desktop.calls.find((call) => call.path === "/api/logins")?.body).toEqual({ site: "zillow.com", username: "ada@example.com", password: "fake-test-pass", bots: "all" }));
  await waitFor(() => expect(screen).toHavePathname("/vault"));
});

test("a secret goes to the Vault's secrets", async () => {
  const desktop = await openPaired("/vault/add?kind=secret", { "POST /api/vault/secrets": jsonResponse(201, { secret: VAULT.secrets[0] }) });
  await fireEvent.changeText(await screen.findByLabelText("Name"), "Stripe secret key");
  await fireEvent.changeText(screen.getByLabelText("Secret"), "sk_test_fake");
  await fireEvent.press(screen.getByText("Save to Vault"));
  await waitFor(() => expect(desktop.calls.find((call) => call.path === "/api/vault/secrets")?.body).toEqual({ name: "Stripe secret key", value: "sk_test_fake", bots: "all" }));
});

test("an item's sheet deletes it after asking, and a linked one can't be deleted here", async () => {
  const desktop = await openPaired("/vault", { "DELETE /api/vault/cards/c1": jsonResponse(200, { ok: true }) });
  const alert = jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.style === "destructive")?.onPress?.());
  await fireEvent.press(await screen.findByText("Visa ending 4242"));
  expect(screen).toHavePathname("/sheets/vault-item");
  await fireEvent.press(await screen.findByText("Delete card"));
  expect(alert).toHaveBeenCalledWith("Delete Visa ending 4242?", expect.stringContaining("can't be undone"), expect.any(Array));
  await waitFor(() => expect(desktop.calls.some((call) => call.method === "DELETE" && call.path === "/api/vault/cards/c1")).toBe(true));
  await waitFor(() => expect(screen).toHavePathname("/vault"));

  await fireEvent.press(screen.getByText("Notion token"));
  expect(await screen.findByText(/linked password manager/)).toBeTruthy();
  expect(screen.queryByText("Delete secret")).toBeNull();
});
