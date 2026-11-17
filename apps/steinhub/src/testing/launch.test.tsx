import type { BotsResponse, WireMessagePage } from "@openmausbot/phone-protocol/responses.ts";
import { Stack } from "expo-router";
import { act, renderRouter, screen, waitFor } from "expo-router/testing-library";
import type { Session } from "@/api/session";
import { chiefThreadId } from "@/state/launch";
import type { BotView, ThreadView } from "@/state/views";
import { fakeFetch, jsonResponse, pushStream, streamResponse } from "@/testing/fake-desktop";
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

type WireBot = BotsResponse["bots"][number];

function bot(fields: Partial<WireBot> & Pick<WireBot, "id" | "name">): WireBot {
  return {
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
    ...fields,
  } as WireBot;
}

const CHIEF = bot({
  id: "b1",
  name: "MausBot",
  chiefOfStaff: true,
  threadId: "t2",
  tasks: [
    { threadId: "t1", title: "Lease renewal", createdAt: AT },
    { threadId: "t2", title: "Morning brief", createdAt: AT + 1 },
  ],
});
const HELPER = bot({ id: "b2", name: "Scout", threadId: "t3", tasks: [{ threadId: "t3", title: "Flights", createdAt: AT }] });

const PAGE: WireMessagePage = { messages: [{ id: "m1", role: "bot", kind: "text", text: "Here's today's brief.", at: AT }], activeLeafId: "m1" };

async function launch(initialUrl: string, bots: WireBot[]) {
  secureValues.clear();
  secureValues.set("steinhub.demo", "off");
  secureValues.set("steinhub.session", JSON.stringify(SESSION));
  const events = pushStream();
  const desktop = fakeFetch({
    "GET /api/events": streamResponse(events),
    "GET /api/bots": jsonResponse(200, { bots, botQueuedMessages: {}, sections: [], groups: [], computerControl: {} } as BotsResponse),
    "GET /api/instances": jsonResponse(200, { instances: [] }),
    "GET /api/routines": jsonResponse(200, { routines: [], runs: [] }),
    "GET /api/companion/endpoints": jsonResponse(200, { serverName: "Ada's Mac", endpoints: [] }),
    "GET /api/threads/t2/messages": jsonResponse(200, PAGE),
  });
  network.fetch = desktop.fetch;
  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl });
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/events")).toBe(true));
  await act(async () => events.frame({ kind: "hello", cursor: "s:1", resumed: false }));
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/bots")).toBe(true));
}

test("a paired app opens on the Chief of Staff's open conversation, not a blank chat", async () => {
  await launch("/", [HELPER, CHIEF]);
  await waitFor(() => expect(screen).toHavePathname("/chat/t2"));
  expect(await screen.findByText("Here's today's brief.")).toBeTruthy();
});

test("an app opened onto another screen stays there", async () => {
  await launch("/bot/b2", [HELPER, CHIEF]);
  expect(await screen.findByText("Scout")).toBeTruthy();
  expect(screen).toHavePathname("/bot/b2");
});

test("with no Chief of Staff the app stays on a new chat", async () => {
  await launch("/", [HELPER]);
  expect(await screen.findByLabelText("Switch bot, Scout")).toBeTruthy();
  expect(screen).toHavePathname("/");
});

test("without an open conversation the Chief of Staff's latest thread is the one", () => {
  const chief = { id: "b1", name: "MausBot", chief: true } as BotView;
  const threads = [
    { id: "t9", botId: "b2" },
    { id: "t5", botId: "b1" },
    { id: "t4", botId: "b1" },
  ] as ThreadView[];
  expect(chiefThreadId([chief], threads)).toBe("t5");
  expect(chiefThreadId([{ ...chief, threadId: "t4" }], threads)).toBe("t4");
  expect(chiefThreadId([{ ...chief, chief: false }], threads)).toBeNull();
});
