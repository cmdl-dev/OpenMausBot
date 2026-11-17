import type { InboxRow, InboxView } from "@openmausbot/phone-protocol/inbox.ts";
import type { BotsResponse } from "@openmausbot/phone-protocol/responses.ts";
import type { RoutinesReply } from "@/api/client";
import { router, Stack } from "expo-router";
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

const CHIEF = bot({ id: "b1", name: "MausBot", chiefOfStaff: true, threadId: "t1", tasks: [{ threadId: "t1", title: "Lease renewal", createdAt: AT }] });
const SCOUT = bot({ id: "b2", name: "Scout", threadId: "t3", tasks: [{ threadId: "t3", title: "Flights", createdAt: AT }] });

const ASK: InboxRow = {
  id: "line-1",
  kind: "ask",
  tab: "needs-you",
  from: { name: "MausBot", botId: "b1" },
  origin: { botId: "b1", threadId: "t1", title: "Lease renewal" },
  text: "Send the reply to Jordan?",
  at: AT,
  unread: true,
  card: { title: "Send reply to Jordan?", subtitle: "Counters at $2,450 a month.", options: ["Approve", "Deny"], tool: "send_email", requestId: "req-1" },
};
const NEWS: InboxRow = {
  id: "line-2",
  kind: "result",
  tab: "info",
  from: { name: "Scout", botId: "b2" },
  origin: { botId: "b2", threadId: "t3", title: "Flights" },
  text: "Fares to Lisbon dropped\nTAP is 20% cheaper this week.",
  at: AT,
  unread: true,
};

async function launch(initialUrl: string, routes: Record<string, Parameters<typeof fakeFetch>[0][string]> = {}, routines?: RoutinesReply) {
  secureValues.clear();
  secureValues.set("steinhub.demo", "off");
  secureValues.set("steinhub.session", JSON.stringify(SESSION));
  const events = pushStream();
  const desktop = fakeFetch({
    "GET /api/events": streamResponse(events),
    "GET /api/bots": jsonResponse(200, { bots: [CHIEF, SCOUT], botQueuedMessages: {}, sections: [], groups: [], computerControl: {} } as BotsResponse),
    "GET /api/instances": jsonResponse(200, { instances: [] }),
    "GET /api/routines": jsonResponse(200, routines ?? { routines: [], runs: [] }),
    "GET /api/companion/endpoints": jsonResponse(200, { serverName: "Ada's Mac", endpoints: [] }),
    "GET /api/threads/t1/messages": jsonResponse(200, { messages: [], activeLeafId: null }),
    "GET /api/threads/t3/messages": jsonResponse(200, { messages: [], activeLeafId: null }),
    ...routes,
  });
  network.fetch = desktop.fetch;
  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl });
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/events")).toBe(true));
  await act(async () => events.frame({ kind: "hello", cursor: "s:1", resumed: false }));
  await waitFor(() => expect(desktop.calls.some((call) => call.path === "/api/bots")).toBe(true));
  return desktop;
}

describe("a bot's memory", () => {
  const MEMORY = {
    text: "# About Ada\n\n- Likes a short morning brief.",
    topics: [{ path: "memory/people.md", name: "people.md", bytes: 40, modifiedAt: AT }],
    logs: [{ path: "memory/log/2026-11-16.md", name: "2026-11-16.md", bytes: 20, modifiedAt: AT }],
  };

  test("Memory on the bot's profile shows what it remembers, and a topic opens to its note", async () => {
    const desktop = await launch("/bot/b2", {
      "GET /api/bots/b2/memory": jsonResponse(200, MEMORY),
      "GET /api/bots/b2/memory/file": (call: Call) =>
        new URL(call.url).searchParams.get("path") === "memory/people.md"
          ? jsonResponse(200, { path: "memory/people.md", text: "Jordan is the landlord.", exists: true })
          : jsonResponse(404, { error: "not found" }),
    });
    await fireEvent.press(await screen.findByText("Memory"));
    expect(screen).toHavePathname("/memory/b2");
    expect(await screen.findByText(/Likes a short morning brief/)).toBeTruthy();
    expect(screen.getByText("2026-11-16")).toBeTruthy();

    await fireEvent.press(screen.getByText("people"));
    expect(await screen.findByText("Jordan is the landlord.")).toBeTruthy();
    expect(desktop.calls.some((call) => call.path === "/api/bots/b2/memory/file")).toBe(true);
  });

  test("a bot that remembers nothing says so", async () => {
    await launch("/memory/b2", { "GET /api/bots/b2/memory": jsonResponse(200, { text: "", topics: [], logs: [] }) });
    expect(await screen.findByText("Scout doesn't remember anything yet.")).toBeTruthy();
  });

  test("what the bot saves shows when the screen comes back into view, and on pull to refresh", async () => {
    let memory = { text: "", topics: [] as unknown[], logs: [] as unknown[] };
    await launch("/memory/b2", { "GET /api/bots/b2/memory": () => jsonResponse(200, memory) });
    expect(await screen.findByText("Scout doesn't remember anything yet.")).toBeTruthy();

    memory = { ...memory, text: "- Prefers window seats." };
    await act(async () => router.push("/bot/b2"));
    await act(async () => router.back());
    expect(await screen.findByText(/Prefers window seats/)).toBeTruthy();

    memory = { ...memory, text: "- Prefers aisle seats now." };
    let scroller = screen.getByLabelText("MEMORY.md").parent;
    while (scroller && !scroller.props.refreshControl) scroller = scroller.parent;
    await act(async () => scroller?.props.refreshControl.props.onRefresh());
    expect(await screen.findByText(/Prefers aisle seats now/)).toBeTruthy();
  });

  test("a computer that won't share memory says what to do instead", async () => {
    await launch("/memory/b2", { "GET /api/bots/b2/memory": jsonResponse(404, { error: "no route: GET /api/bots/b2/memory" }) });
    expect(await screen.findByText(/doesn't let phones do that/)).toBeTruthy();
  });
});

describe("the inbox", () => {
  test("shows the computer's own inbox, and Approve answers the card where it was asked", async () => {
    let view: InboxView = { botId: null, threadId: null, rows: [ASK, NEWS], anchor: null };
    const desktop = await launch("/inbox", {
      "GET /api/inbox": () => jsonResponse(200, view),
      "POST /api/threads/t1/respond": () => {
        view = { ...view, rows: [{ ...NEWS }] };
        return jsonResponse(200, {});
      },
    });
    expect(await screen.findByText("Send reply to Jordan?")).toBeTruthy();
    expect(screen.queryByText(/Sample data/)).toBeNull();
    expect(screen.getByText("Fares to Lisbon dropped")).toBeTruthy();

    await fireEvent.press(screen.getByText("Approve"));
    await waitFor(() => expect(screen.queryByText("Send reply to Jordan?")).toBeNull());
    const answer = desktop.calls.find((call) => call.path === "/api/threads/t1/respond");
    expect(answer?.body).toEqual({ requestId: "req-1", behavior: "allow" });
  });

  test("Mark all as read reads every line on the computer", async () => {
    const view: InboxView = { botId: null, threadId: null, rows: [NEWS], anchor: null };
    const desktop = await launch("/inbox", {
      "GET /api/inbox": jsonResponse(200, view),
      "POST /api/inbox/read-all": jsonResponse(200, { ...view, rows: [{ ...NEWS, unread: false }] }),
    });
    await fireEvent.press(await screen.findByLabelText("Mark all as read"));
    await waitFor(() => expect(desktop.calls.some((call) => call.method === "POST" && call.path === "/api/inbox/read-all")).toBe(true));
    await waitFor(() => expect(screen.queryByLabelText("Mark all as read")).toBeNull());
  });

  test("a line opens the conversation it came from", async () => {
    await launch("/inbox", { "GET /api/inbox": jsonResponse(200, { botId: null, threadId: null, rows: [NEWS], anchor: null }) });
    await fireEvent.press(await screen.findByText("Fares to Lisbon dropped"));
    expect(screen).toHavePathname("/chat/t3");
  });

  test("a computer that serves no inbox shows the sample, with nothing to press that can't work", async () => {
    await launch("/inbox", { "GET /api/inbox": jsonResponse(404, { error: "no route" }) });
    expect(await screen.findByText(/Sample data/)).toBeTruthy();
    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByLabelText("Mark all as read")).toBeNull();
  });
});

test("New automation starts a chat with the Chief of Staff, drafted", async () => {
  await launch("/automations");
  await fireEvent.press(await screen.findByLabelText("New automation"));
  expect(await screen.findByLabelText("Switch bot, MausBot")).toBeTruthy();
  expect(screen.getByLabelText("Message").props.value).toBe("Set up an automation that ");
});

test("New chat on a bot's profile starts a chat with that bot", async () => {
  await launch("/bot/b2");
  await fireEvent.press(await screen.findByText("New chat"));
  expect(await screen.findByLabelText("Switch bot, Scout")).toBeTruthy();
});

test("a run that reported to a conversation opens it", async () => {
  const routines: RoutinesReply = {
    routines: [
      {
        id: "r1",
        name: "Morning brief",
        botId: "b1",
        enabled: true,
        prompt: "Brief me",
        schedule: { type: "cron", expression: "0 7 * * *", timeZone: "UTC" },
        runOn: "local",
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    runs: [
      { id: "run-1", routineId: "r1", botId: "b1", scheduledFor: AT, startedAt: AT, finishedAt: AT + 60_000, status: "succeeded", output: "All quiet.", report: { state: "posted", threadId: "t1", messageId: "m1" } },
    ],
  } as unknown as RoutinesReply;
  await launch("/automations/r1", {}, routines);
  await fireEvent.press(await screen.findByText("All quiet."));
  expect(screen).toHavePathname("/chat/t1");
});
