import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboundHold, OutboundHoldBot } from "../outbound-hold.ts";
import { callsSettings, callsNotReadyText, type CallsConfigInput, type ReadyCalls } from "./config.ts";
import { createCalls, type Calls } from "./manager.ts";
import type { CallProvider } from "./provider.ts";
import { createCallRoutes, PLACE_CALL_TOOL } from "./routes.ts";

const SID = `AC${"b".repeat(32)}`;
const CONFIG: CallsConfigInput = { calls: { accountSid: SID, authToken: "tok-abcdefghijkl", callerId: "+14155550199", publicUrl: "https://calls.example.com" }, openai: { key: "sk-x" } };
const BOT: OutboundHoldBot = { id: "bot-1", name: "Iris", color: "#000", outbound: { policy: "allow" } } as unknown as OutboundHoldBot;

let dir: string;
let cfg: CallsConfigInput;
let provider: CallProvider & { placed: string[]; hungUp: string[] };
let calls: Calls;
let holds: Array<Parameters<OutboundHold["hold"]>[0]>;
let answer: "allow" | "deny";

function fakeProvider() {
  const placed: string[] = [];
  const hungUp: string[] = [];
  return {
    name: "twilio" as const, placed, hungUp,
    async place(call: { to: string }) { placed.push(call.to); return { providerCallId: `CA${placed.length}` }; },
    async hangUp(id: string) { hungUp.push(id); },
    async progress() { return { kind: "answered" as const }; },
  };
}

const settings = (): ReadyCalls | { refusal: string } => callsSettings(cfg).ready ?? { refusal: callsNotReadyText(cfg)! };

function route(action: string, body: Record<string, unknown>, active = () => true) {
  let out: { status: number; body: Record<string, unknown> } | null = null;
  const routes = createCallRoutes({
    calls: () => calls, settings, personName: () => "Cesar", markOutside: vi.fn(),
    outbound: () => ({
      async hold(input) {
        holds.push(input);
        return answer === "allow" ? { ok: true, approved: true } : { ok: false, text: "OpenMausBot did not send this: the user declined." };
      },
      beforeDispatch(input) { if (!input.approved) throw new Error("needs approval"); },
    }),
  });
  return routes.internal({
    method: "POST", path: `/api/internal/calls/${action}`, res: {} as ServerResponse, readBody: async () => body, bot: BOT, threadId: "thread-1", active,
    json: ((_res: unknown, status: number, payload: Record<string, unknown>) => { out = { status, body: payload }; }) as never,
  }).then(() => out!);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-call-routes-"));
  cfg = structuredClone(CONFIG);
  provider = fakeProvider();
  holds = [];
  answer = "allow";
  calls = createCalls({ dataDir: dir, settings, provider: () => provider, openRealtime: () => { throw new Error("no voice here"); }, card: { show: () => null, update: () => {} }, followUp: async () => {}, log: () => {} });
});

afterEach(() => {
  calls.close();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe("place_call guardrails", () => {
  it("says exactly which settings are missing, before asking the person anything", async () => {
    cfg = { calls: { callerId: "+14155550199" } };
    const out = await route("place", { to: "+14155550100", brief: "Ask whether they are open on Sunday." });
    expect(out.status).toBe(409);
    expect(out.body.error).toBe("Phone calls aren't set up yet. Missing: Settings → API keys → Twilio Account SID (or OMB_TWILIO_ACCOUNT_SID); Settings → API keys → Twilio auth token (or OMB_TWILIO_AUTH_TOKEN); Settings → API keys → OpenAI (or OMB_OPENAI_API_KEY); Settings → Phone calls → Public address (or OMB_CALLS_PUBLIC_URL).");
    expect(holds).toHaveLength(0);
    expect(provider.placed).toHaveLength(0);
  });

  it("refuses a number that isn't E.164, or that the lists keep out, before asking", async () => {
    expect((await route("place", { to: "415 555 0100", brief: "Ask whether they are open." })).status).toBe(400);
    cfg.calls = { ...cfg.calls, deny: ["+1900*"] };
    expect(await route("place", { to: "+19005550100", brief: "Ask whether they are open." })).toMatchObject({ status: 403, body: { error: expect.stringContaining("denylist") } });
    cfg.calls = { ...cfg.calls, allow: ["+44*"], deny: [] };
    expect(await route("place", { to: "+14155550100", brief: "Ask whether they are open." })).toMatchObject({ status: 403, body: { error: expect.stringContaining("allowlist") } });
    expect(holds).toHaveLength(0);
    expect(provider.placed).toHaveLength(0);
  });

  it("asks the person every time, even for a bot whose rule sends without asking", async () => {
    const out = await route("place", { to: "+1 415 555 0100", brief: "Ask whether they are open on Sunday.", callee_name: "Luigi's" });
    expect(out.status).toBe(200);
    expect(out.body.text).toMatch(/^call_id c-[0-9a-f-]{36}\. Calling \+14155550100 now from \+14155550199/);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ tool: PLACE_CALL_TOOL, fullAccess: false, opaque: false, bot: { id: "bot-1", outbound: { policy: "ask" } } });
    expect(holds[0]!.calls).toEqual([{ slug: "place_call", arguments: { to: "+14155550100", callee_name: "Luigi's", brief: "Ask whether they are open on Sunday." } }]);
    expect(provider.placed).toEqual(["+14155550100"]);
  });

  it("doesn't call when the person declines or the turn ended while waiting", async () => {
    answer = "deny";
    expect(await route("place", { to: "+14155550100", brief: "Ask whether they are open." })).toMatchObject({ status: 403, body: { error: expect.stringContaining("declined") } });
    answer = "allow";
    expect((await route("place", { to: "+14155550100", brief: "Ask whether they are open." }, () => false)).status).toBe(409);
    expect(provider.placed).toHaveLength(0);
  });

  it("runs one call per bot at a time and never calls the caller ID itself", async () => {
    expect((await route("place", { to: "+14155550199", brief: "Ask whether they are open." })).status).toBe(403);
    expect((await route("place", { to: "+14155550100", brief: "Ask whether they are open." })).status).toBe(200);
    expect(await route("place", { to: "+14155550101", brief: "Ask whether they are open." })).toMatchObject({ status: 409, body: { error: expect.stringContaining("already have a call running") } });
  });

  it("answers status, transcript and hang_up only for the bot's own calls", async () => {
    const placed = await route("place", { to: "+14155550100", brief: "Ask whether they are open." });
    const id = /call_id (c-[0-9a-f-]{36})/.exec(String(placed.body.text))![1]!;
    expect((await route("status", { call_id: id })).body.text).toContain(`call_id ${id} to +14155550100: dialing.`);
    expect((await route("transcript", { call_id: id })).body.text).toContain("No transcript.");
    expect((await route("status", { call_id: "c-00000000-0000-0000-0000-000000000000" })).status).toBe(404);
    expect((await route("hang_up", { call_id: id })).body.text).toContain("Hanging up now.");
    expect(provider.hungUp).toEqual(["CA1"]);
  });
});

describe("call limits", () => {
  it("asks the voice to wrap up, then hangs up at the time limit, and ends with that reason", async () => {
    vi.useFakeTimers();
    const record = await calls.place({ botId: "bot-1", botName: "Iris", threadId: "t", to: "+14155550100", brief: "Ask.", onBehalfOf: "Cesar" });
    calls.status(record.id, { CallStatus: "in-progress" }, () => ({ kind: "answered" }));
    expect(calls.record(record.id)!.phase).toBe("in_progress");
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(provider.hungUp).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(provider.hungUp).toEqual(["CA1"]);
    calls.status(record.id, { CallStatus: "completed" }, () => ({ kind: "ended", reason: "completed" }));
    expect(calls.record(record.id)).toMatchObject({ phase: "ended", endReason: "max_length" });
  });

  it("hangs up an answered call whose audio stream never arrives, saying why", async () => {
    vi.useFakeTimers();
    const record = await calls.place({ botId: "bot-1", botName: "Iris", threadId: "t", to: "+14155550100", brief: "Ask.", onBehalfOf: "Cesar" });
    calls.answer(record.id);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(provider.hungUp).toEqual(["CA1"]);
    calls.status(record.id, { CallStatus: "completed" }, () => ({ kind: "ended", reason: "completed" }));
    expect(calls.record(record.id)).toMatchObject({ phase: "ended", endReason: "error", endDetail: expect.stringContaining("forwards WebSockets") });
  });

  it("ends the call by itself when the provider never confirms a hang-up", async () => {
    vi.useFakeTimers();
    const record = await calls.place({ botId: "bot-1", botName: "Iris", threadId: "t", to: "+14155550100", brief: "Ask.", onBehalfOf: "Cesar" });
    await calls.hangUp(record.id, "hung_up");
    expect(calls.record(record.id)!.phase).toBe("dialing");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.record(record.id)).toMatchObject({ phase: "ended", endReason: "hung_up" });
  });

  it("after a restart, hangs up a call that lost its voice", async () => {
    const other = mkdtempSync(join(tmpdir(), "omb-call-resume-"));
    mkdirSync(join(other, "calls"));
    writeFileSync(join(other, "calls", "calls.json"), JSON.stringify({ calls: [{ id: "c-1", botId: "b", botName: "Iris", threadId: "t", to: "+14155550100", brief: "x", onBehalfOf: "C", provider: "twilio", providerCallId: "CA9", maxMinutes: 10, phase: "in_progress", createdAt: 1, answeredAt: 2, lines: 0 }] }));
    const prompts: string[] = [];
    const resumed = createCalls({ dataDir: other, settings, provider: () => provider, openRealtime: () => { throw new Error("no"); }, card: { show: () => null, update: () => {} }, followUp: async (_r, prompt) => void prompts.push(prompt), log: () => {} });
    await resumed.resume();
    expect(provider.hungUp).toEqual(["CA9"]);
    expect(resumed.record("c-1")).toMatchObject({ phase: "ended", endReason: "lost" });
    expect(prompts).toHaveLength(1);
    resumed.close();
    rmSync(other, { recursive: true, force: true });
  });
});
