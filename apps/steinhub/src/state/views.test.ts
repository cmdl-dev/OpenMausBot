import type { Routine, RoutineRun } from "@openmausbot/phone-protocol/routines.ts";
import type { WireBot, WireMessage } from "@openmausbot/phone-protocol/wire.ts";
import { emptyWorld, worldReducer, type LiveWorld, type WorldAction } from "@/state/live-world";
import { automationView, botSections, botView, formatWhen, messageViews, threadViews, toolLabel } from "@/state/views";

const NOW = new Date(2026, 10, 16, 9, 41).getTime();

function bot(overrides: Partial<WireBot> = {}): WireBot {
  return {
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
    createdAt: NOW - 1e7,
    tasks: [
      { threadId: "t1", title: "Lease renewal", createdAt: NOW - 1e6, lastThreadOrderAt: NOW - 1e5 },
      { threadId: "t2", title: "Old one", createdAt: NOW - 3 * 86_400_000 },
      { threadId: "t3", title: "A routine run", createdAt: NOW, routineRunId: "run1" },
    ],
    ...overrides,
  };
}

const text = (id: string, role: WireMessage["role"], words: string, extra: Partial<WireMessage> = {}): WireMessage => ({
  id,
  role,
  kind: "text",
  text: words,
  at: NOW,
  ...extra,
});

function run(world: LiveWorld, ...actions: WorldAction[]): LiveWorld {
  return actions.reduce(worldReducer, world);
}

test("a bot reads as its name, title, tint, model label and activity", () => {
  expect(botView(bot({ activity: "waiting-on-you" }), 0, { "claude-opus-5-5": "Claude Opus 5.5" })).toMatchObject({
    name: "MausBot",
    role: "Chief of Staff",
    tint: "violet",
    model: "Claude Opus 5.5",
    state: { label: "Waiting on you", tone: "warning" },
  });
});

test("threads leave out routine runs and group by recency", () => {
  expect(threadViews([bot()], NOW).map(({ id, group }) => [id, group])).toEqual([
    ["t1", "Today"],
    ["t2", "Earlier"],
  ]);
});

test("tool rows stay out of the thread; cards become approvals", () => {
  const views = messageViews([
    text("m1", "user", "Send it"),
    { id: "a1", role: "bot", kind: "activity", at: NOW },
    { id: "a2", role: "bot", kind: "activity", at: NOW },
    text("m2", "bot", "Drafted."),
    {
      id: "c1",
      role: "bot",
      kind: "options",
      at: NOW,
      card: { title: "Send this reply?", subtitle: "Hi Jordan", options: ["Allow", "Deny"], tool: "mcp__gmail__send_email", requestId: "r1", requestType: "permission" },
    },
  ]);
  expect(views).toEqual([
    { id: "m1", from: "user", text: "Send it" },
    { id: "m2", from: "bot", text: "Drafted.", at: NOW },
    expect.objectContaining({ id: "c1", from: "approval", kind: "permission", action: "Send email", state: "pending", requestId: "r1", preview: "Hi Jordan" }),
  ]);
});

test("an answered approval reads as approved or denied", () => {
  const card = { title: "Run it?", subtitle: "", options: ["Allow", "Deny"], tool: "Bash", requestId: "r1" };
  const [allowed] = messageViews([{ id: "c", role: "bot", kind: "options", at: NOW, card: { ...card, answered: "Allow" } }]);
  const [denied] = messageViews([{ id: "c", role: "bot", kind: "options", at: NOW, card: { ...card, answered: "Deny" } }]);
  expect(allowed).toMatchObject({ state: "approved" });
  expect(denied).toMatchObject({ state: "denied" });
});

test("streamed text shows until the saved message with its item id arrives", () => {
  const delta = (piece: string): WorldAction => ({
    type: "frame",
    frame: {
      kind: "runtime",
      event: { eventId: piece, provider: "claude", threadId: "t1", createdAt: "", itemId: "i1", type: "content.delta", streamKind: "assistant_text", delta: piece },
    },
  });
  const streaming = run(emptyWorld, delta("Hel"), delta("lo"));
  expect(messageViews([], { streaming: streaming.streaming.t1 })).toEqual([{ id: "live:i1", from: "bot", text: "Hello", streaming: true }]);

  const saved = run(streaming, { type: "frame", frame: { kind: "message", threadId: "t1", message: text("m9", "bot", "Hello", { itemId: "i1" }) } });
  expect(saved.streaming.t1).toEqual([]);
  expect(saved.threads.t1.messages.map((message) => message.id)).toEqual(["m9"]);
});

test("a sent line stays pending until its echo carries the same send id", () => {
  const sending = run(emptyWorld, { type: "sending", threadId: "t1", send: { sendId: "s1", text: "hi" } });
  expect(messageViews([], { pending: sending.pending.t1 })).toEqual([{ id: "send:s1", from: "user", text: "hi", pending: "sending" }]);
  const echoed = run(sending, { type: "message", threadId: "t1", message: text("m1", "user", "hi", { sendId: "s1" }) });
  expect(echoed.pending.t1).toEqual([]);
});

test("a busy thread with nothing streamed yet shows the bot working", () => {
  expect(messageViews([text("m1", "user", "go"), { id: "a", role: "bot", kind: "activity", at: NOW }], { busy: true }).at(-1)).toEqual({
    id: "working",
    from: "working",
  });
});

test("work handed to a teammate and its answer read as hand-off rows", () => {
  const views = messageViews([
    {
      id: "h1",
      role: "bot",
      kind: "activity",
      at: NOW,
      tool: { name: "Sent to eBay Seller", ok: true },
      doneWhen: "Fees and subscription costs compared",
      threadRef: { botId: "b2", threadId: "t9", title: "Store fees" },
    },
    {
      id: "h2",
      role: "bot",
      kind: "activity",
      at: NOW + 1,
      tool: { name: "eBay Seller replied", ok: true, output: "Basic Store is the best option." },
      roomRequest: { id: "r1", phase: "result" },
      threadRef: { botId: "b2", threadId: "t9", title: "Store fees" },
    },
  ]);
  expect(views).toEqual([
    { id: "h1", from: "handoff", label: "Sent to eBay Seller", ok: true, doneWhen: "Fees and subscription costs compared", result: undefined, threadId: "t9" },
    { id: "h2", from: "handoff", label: "eBay Seller replied", ok: true, doneWhen: undefined, result: "Basic Store is the best option.", threadId: "t9" },
  ]);
});

test("pages merge with live frames in time order", () => {
  const live = run(emptyWorld, { type: "frame", frame: { kind: "message", threadId: "t1", message: text("m3", "bot", "new", { at: NOW + 3 }) } });
  const paged = run(live, { type: "page", threadId: "t1", page: { messages: [text("m1", "user", "a", { at: NOW + 1 }), text("m2", "bot", "b", { at: NOW + 2 })], activeLeafId: null, hasMore: true } });
  expect(paged.threads.t1).toMatchObject({ loaded: true, hasMore: true });
  expect(paged.threads.t1.messages.map((message) => message.id)).toEqual(["m1", "m2", "m3"]);
});

test("an automation shows its schedule, last run, next run and on/off state", () => {
  const routine = {
    id: "r1",
    name: "Morning brief",
    prompt: "",
    target: "bot",
    botId: "b1",
    runOn: "maus",
    enabled: true,
    schedule: { type: "daily", time: "07:00", weekdays: [1, 2, 3, 4, 5] },
    durationMinutes: 30,
    nextRunAt: new Date(2026, 10, 17, 7, 0).getTime(),
    createdAt: 0,
    updatedAt: 0,
  } satisfies Routine;
  const runs: RoutineRun[] = [
    { id: "x1", routineId: "r1", routineName: "Morning brief", target: "bot", botId: "b1", runOn: "maus", scheduledFor: NOW - 3 * 3_600_000, finishedAt: NOW - 3 * 3_600_000, status: "completed", manual: false, output: "Brief sent", createdAt: 0 },
  ];
  expect(automationView(routine, runs, "Ada's Mac", NOW)).toMatchObject({
    trigger: { kind: "schedule", label: "Weekdays at 7:00" },
    runsOn: "Ada's Mac",
    state: "active",
    lastRun: { label: "Today 6:41", tone: "success" },
    next: "Next tomorrow 7:00",
    runs: [{ id: "x1", summary: "Brief sent" }],
  });
  expect(automationView({ ...routine, enabled: false, failureStreak: 2 }, [], "Ada's Mac", NOW).state).toBe("failed");
});

test("times and tools read the way the mockups write them", () => {
  expect(formatWhen(new Date(2026, 10, 13, 7, 0).getTime(), NOW)).toBe("Fri 7:00");
  expect(toolLabel("Bash")).toBe("Bash");
  expect(toolLabel(undefined)).toBe("Question");
});

test("bots group into the computer's sections, unsectioned first and each Chief of Staff on top", () => {
  const view = (id: string, section?: string, chief?: boolean) => ({ ...botView(bot({ id, name: id }), 0, {}), section, chief });
  const sections = botSections(
    [view("a"), view("sales-1", "Sales"), view("ops-1", "Ops"), view("sales-chief", "Sales", true), view("b")],
    ["Sales", "Empty"],
  );
  expect(sections.map((section) => [section.name, section.bots.map((entry) => entry.id)])).toEqual([
    [null, ["a", "b"]],
    ["Sales", ["sales-chief", "sales-1"]],
    ["Ops", ["ops-1"]],
  ]);
});
