import type { BotsResponse, WireMessagePage } from "@openmausbot/phone-protocol/responses.ts";
import { Stack } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import type { Session } from "@/api/session";
import { resetPreferences } from "@/state/preferences";
import { pushKinds, pushTarget, quietHours } from "@/state/push";
import { fakeFetch, jsonResponse, pushStream, streamResponse, type Call } from "@/testing/fake-desktop";
import { pushes } from "@/testing/mocks/expo-notifications";
import { network, secureValues } from "@/testing/native-mocks";

jest.mock("expo-secure-store", () => jest.requireActual("@/testing/native-mocks").secureStore);
jest.mock("expo-crypto", () => jest.requireActual("@/testing/native-mocks").crypto);
jest.mock("expo-camera", () => jest.requireActual("@/testing/native-mocks").camera);
jest.mock("expo/fetch", () => ({ fetch: (...args: unknown[]) => jest.requireActual("@/testing/native-mocks").network.fetch(...args) }));

function DrawerWithoutAnimation() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

const AT = Date.UTC(2026, 10, 17, 9, 0);
const SESSION: Session = {
  token: "device-token-1",
  urls: ["http://mac.local:8810"],
  serverName: "Ada's Mac",
  device: { id: "device-0001", name: "Test iPhone", createdAt: 1, lastSeenAt: 1 },
  pairedAt: AT,
};

const BOTS = {
  bots: [
    {
      id: "b1",
      threadId: "t1",
      name: "MausBot",
      title: "",
      description: "",
      notifications: true,
      color: "purple",
      avatarUrl: null,
      unread: false,
      modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
      createdAt: 1,
      tasks: [{ threadId: "t1", title: "Inbox watch", createdAt: AT }],
      messages: [],
      activeLeafId: null,
    },
  ],
  botQueuedMessages: {},
  sections: [],
  groups: [],
  computerControl: {},
} as unknown as BotsResponse;

const PAGE: WireMessagePage = {
  messages: [
    { id: "m1", role: "bot", kind: "text", text: "Nothing new in your inbox.", at: AT },
    { id: "m2", role: "bot", kind: "text", text: "Your landlord replied: the lease renewal is due **Friday**.", at: AT + 1, alert: { title: "Lease renewal due Friday" } },
  ],
  activeLeafId: "m2",
};

async function open(initialUrl: string) {
  secureValues.set("steinhub.demo", "off");
  secureValues.set("steinhub.session", JSON.stringify(SESSION));
  const events = pushStream();
  const registrations: unknown[] = [];
  const desktop = fakeFetch({
    "GET /api/events": streamResponse(events),
    "GET /api/bots": jsonResponse(200, BOTS),
    "GET /api/instances": jsonResponse(200, { instances: [] }),
    "GET /api/routines": jsonResponse(200, { routines: [], runs: [] }),
    "GET /api/companion/endpoints": jsonResponse(200, { serverName: "Ada's Mac", endpoints: [] }),
    "GET /api/threads/t1/messages": jsonResponse(200, PAGE),
    "PUT /api/push/device": (call: Call) => {
      registrations.push(call.body);
      return jsonResponse(200, { push: "on", device: null });
    },
  });
  network.fetch = desktop.fetch;
  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl });
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/events")).toBe(true));
  await act(async () => events.frame({ kind: "hello", cursor: "s:1", resumed: false }));
  return { desktop, registrations };
}

beforeEach(() => {
  secureValues.clear();
  resetPreferences();
  pushes.reset();
});

test("a phone that may notify registers with its computer for what needs the person, and asks again when a switch changes", async () => {
  pushes.granted = true;
  const { registrations } = await open("/notifications");
  await waitFor(() => expect(registrations).toHaveLength(1));
  expect(registrations[0]).toEqual({
    platform: "apns",
    token: "ab".repeat(32),
    environment: "sandbox",
    kinds: ["approval", "question", "sign-in", "alert", "wait"],
    pairing: "device-0001",
  });
  expect(await screen.findByText("On. Ada's Mac will notify this phone.")).toBeTruthy();

  await fireEvent(screen.getByLabelText("Every finished reply"), "valueChange", true);
  await waitFor(() => expect(registrations).toHaveLength(2));
  expect((registrations[1] as { kinds: string[] }).kinds).toContain("done");

  await fireEvent(screen.getByLabelText("Quiet hours"), "valueChange", true);
  await waitFor(() => expect(registrations).toHaveLength(3));
  expect((registrations[2] as { quiet: unknown }).quiet).toEqual({ start: "22:00", end: "07:00", timeZone: expect.any(String) });
});

test("a paired phone asks once whether it may notify", async () => {
  await open("/settings");
  await waitFor(() => expect(pushes.asked).toBe(1));
  expect(JSON.parse(secureValues.get("steinhub.preferences") ?? "{}").pushAsked).toBe(true);
});

test("a tapped notification opens its conversation at the message it points at, marked as the alert", async () => {
  pushes.granted = true;
  await open("/settings");
  await act(async () => pushes.tap({ omb: { v: 1, kind: "alert", botId: "b1", threadId: "t1", messageId: "m2" } }));
  await waitFor(() => expect(screen).toHavePathname("/chat/t1"));
  expect(await screen.findByLabelText("Notified you: Lease renewal due Friday")).toBeTruthy();

  const marker = screen.getByLabelText("Notified you: Lease renewal due Friday");
  let row = marker.parent;
  while (row && !row.props.onLayout) row = row.parent;
  await act(async () => row?.props.onLayout({ nativeEvent: { layout: { x: 0, y: 640, width: 390, height: 120 } } }));
  expect(row?.props.accessibilityState).toEqual({ selected: true });
});

test("the push's data is read whether it comes direct or through the relay, and kinds follow the switches", () => {
  expect(pushTarget({ omb: { threadId: "t1", messageId: "m2" } })).toEqual({ threadId: "t1", messageId: "m2" });
  expect(pushTarget({ body: JSON.stringify({ v: 1, threadId: "t9" }) })).toEqual({ threadId: "t9" });
  expect(pushTarget({ omb: { threadId: "../etc" } })).toBeNull();
  expect(pushKinds({ needsYou: false, alerts: true, reminders: false, replies: true })).toEqual(["alert", "done"]);
  expect(quietHours({ on: false, start: "22:00", end: "07:00" })).toBeUndefined();
  expect(quietHours({ on: true, start: "23:30", end: "06:00" }, "America/Los_Angeles")).toEqual({ start: "23:30", end: "06:00", timeZone: "America/Los_Angeles" });
});
