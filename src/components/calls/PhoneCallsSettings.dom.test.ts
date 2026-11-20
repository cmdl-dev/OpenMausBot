// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { CallDetail, CallSummary, CallsSetup } from "../../../shared/phone-calls";
import { CALL_PROMPT_KEYS, CALL_SETTINGS } from "../../../shared/phone-calls";

const fx = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  api: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("@/state/store", async (original) => {
  const actual = await original<typeof import("@/state/store")>();
  return {
    ...actual,
    api: (...args: unknown[]) => fx.api(...args),
    useStore: () => ({ state: { ...actual.initialState, config: fx.config }, dispatch: fx.dispatch }),
  };
});

const { PhoneCallsSettings } = await import("./PhoneCallsSettings");

const READY: CallsSetup = {
  ready: true, missing: [], problems: [], provider: "twilio", callerId: "+14155550123", publicUrl: "https://calls.example.com",
  maxMinutes: 10, model: "gpt-realtime-2.1-mini", voice: "marin", allow: [], deny: ["+1900*"], port: 8805, listening: true,
  transcriptionModel: "gpt-4o-mini-transcribe", turnDetection: { type: "server_vad", threshold: 0.5, prefixPaddingMs: 300, silenceDurationMs: 500 },
  noiseReduction: "near_field", maxTurnsWithoutReply: 3,
  prompts: {
    ...Object.fromEntries(CALL_PROMPT_KEYS.map((key) => [key, { value: `Default ${key} for {callee}.`, default: `Default ${key} for {callee}.`, custom: false }])) as CallsSetup["prompts"],
    opening: { value: "Greet {callee} and say why you're calling.", default: "Default opening.", custom: true },
  },
  tools: [{ type: "function", name: "end_call", description: "Default endCallDescription for {callee}.", parameters: { type: "object", properties: {} } }],
};

const NOW = Date.now();
const ENDED: CallSummary = {
  id: "c1", botId: "b1", botName: "Ada", threadId: "t1", to: "+14155550199", calleeName: "Dr. Lee's office", goal: "Book a cleaning",
  phase: "ended", createdAt: NOW - 3_600_000, answeredAt: NOW - 3_590_000, endedAt: NOW - 3_500_000, endReason: "completed", seconds: 90, lines: 3,
};
const LIVE: CallSummary = { ...ENDED, id: "c2", calleeName: undefined, to: "+442071234567", phase: "in_progress", endedAt: undefined, endReason: undefined, seconds: 12 };
const DETAIL: CallDetail = {
  ...ENDED, brief: "Book a cleaning for Tuesday morning.\nName: Sam.",
  transcript: [
    { speaker: "note", text: "This call is from an AI assistant.", at: NOW - 3_590_000 },
    { speaker: "bot", text: "Hi, I'm calling to book a cleaning.", at: NOW - 3_585_000, cut: true },
    { speaker: "callee", text: "Tuesday at nine works.", at: NOW - 3_525_000 },
  ],
  sent: {
    disclosure: "This call is from an AI assistant.", instructions: "You are calling Dr. Lee's office for Sam.", opening: "Greet Dr. Lee's office.",
    wrapUp: "Wrap up now.", goodbye: "Say goodbye.", model: "gpt-realtime-2.1-mini", voice: "marin", transcriptionModel: "gpt-4o-mini-transcribe",
    turnDetection: { type: "semantic_vad", eagerness: "low" }, noiseReduction: "far_field", maxTurnsWithoutReply: 3, maxMinutes: 10,
    session: { type: "realtime", instructions: "You are calling Dr. Lee's office for Sam." },
  },
};

let host: HTMLDivElement;
let root: Root;
let setup: CallsSetup;
let calls: CallSummary[];

const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => {});
  }
};
const render = async () => {
  flushSync(() => root.render(createElement(PhoneCallsSettings)));
  await settle();
};
const field = <T extends HTMLInputElement | HTMLTextAreaElement>(name: string) => $<T>(`[data-calls-form] [name="${name}"]`)!;
const prompt = (key: string) => $<HTMLTextAreaElement>(`[data-calls-prompts] [name="${key}"]`)!;
const voiceSave = () => $<HTMLButtonElement>('[data-calls-save="calls-voice"]')!;
function choose(element: HTMLSelectElement, value: string) {
  flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  flushSync(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const puts = () => fx.api.mock.calls.filter(([path, init]) => path === "/api/config" && init?.method === "PUT");

beforeEach(() => {
  setLocale("en");
  setup = READY;
  calls = [LIVE, ENDED];
  fx.config = { savedKeys: { twilioAccountSid: { configured: true, last4: "beef" }, twilioAuthToken: { configured: false } }, openai: { configured: true } };
  fx.dispatch.mockReset();
  fx.api.mockReset();
  fx.api.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path === "/api/calls/setup") return setup;
    if (path === "/api/calls") return { calls };
    if (path === "/api/config" && init?.method === "PUT") return { ...fx.config, saved: JSON.parse(init.body!) };
    if (path === "/api/calls/c1") return DETAIL;
    if (path === "/api/calls/c2") return { ...DETAIL, ...LIVE, transcript: [] };
    if (path === "/api/calls/c2/hang-up") return { ok: true };
    throw new Error(`unexpected ${path}`);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("Phone calls setup", () => {
  it("says it is ready, which keys are saved, and what to expose", async () => {
    await render();
    expect($("[data-calls-ready]")?.textContent).toBe("Ready");
    expect(host.querySelector("[data-calls-missing]")).toBeNull();
    expect($('[data-calls-key="twilioSid"]')?.textContent).toContain("Connected");
    expect($('[data-calls-key="twilioToken"]')?.textContent).toContain("Not set");
    expect($('[data-calls-key="openai"]')?.textContent).toContain("Connected");
    expect($("[data-calls-expose]")?.textContent).toContain("8805");
    expect($("[data-calls-expose]")?.textContent).toContain("https://calls.example.com/calls/twilio/*");
  });

  it("lists exactly the missing settings with their environment variables, and the problems in the server's words", async () => {
    setup = {
      ...READY, ready: false, callerId: undefined, publicUrl: undefined, listening: false,
      missing: [CALL_SETTINGS.twilioAuthToken, CALL_SETTINGS.callerId], problems: ["The public address must start with https://."],
    };
    await render();
    expect($("[data-calls-ready]")).toBeNull();
    expect(host.textContent).toContain("Not set up yet");
    const missing = [...host.querySelectorAll<HTMLElement>("[data-calls-missing]")];
    expect(missing.map((element) => element.dataset.callsMissing)).toEqual(["twilioAuthToken", "callerId"]);
    expect(missing[0]!.textContent).toContain("OMB_TWILIO_AUTH_TOKEN");
    expect(missing[1]!.textContent).toContain("OMB_CALLS_CALLER_ID");
    expect(host.textContent).toContain("Twilio auth token");
    expect(host.textContent).toContain("Caller ID number");
    expect($("[data-calls-problem]")?.textContent).toBe("The public address must start with https://.");
    expect(host.textContent).toContain("Nothing answers on this port yet.");
    flushSync(() => $<HTMLButtonElement>('[data-calls-key="twilioToken"]')!.click());
    expect(fx.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "connections" });
  });

  it("says so with a retry when setup can't be read", async () => {
    fx.api.mockImplementation(async (path: string) => {
      if (path === "/api/calls/setup") throw new Error("Server unreachable");
      return { calls: [] };
    });
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Server unreachable");
    expect(host.querySelector("[data-calls-form]")).toBeNull();
  });
});

describe("Phone calls fields", () => {
  it("saves only what changed, normalised, and deletes cleared fields with null", async () => {
    await render();
    expect(field("callerId").value).toBe("+14155550123");
    expect(field("deny").value).toBe("+1900*");
    type(field("callerId"), "+1 (415) 555-0100");
    type(field("allow"), "+1415*, +44 20 7123 4567\n");
    type(field("deny"), "");
    type(field("onBehalfOf"), "Sam Rivera");
    flushSync(() => $<HTMLButtonElement>('[data-calls-save="calls-settings"]')!.click());
    await settle();
    expect(puts()).toHaveLength(1);
    expect(JSON.parse(puts()[0]![1].body)).toEqual({ calls: { callerId: "+14155550100", allow: ["+1415*", "+442071234567"], deny: null, onBehalfOf: "Sam Rivera" } });
    expect(fx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "configStatus" }));
    expect(host.textContent).toContain("Saved.");
  });

  it("refuses a number without its country code, an http address and minutes out of range, without saving", async () => {
    await render();
    type(field("callerId"), "415 555 0100");
    type(field("publicUrl"), "http://calls.example.com");
    type(field("maxMinutes"), "90");
    type(field("allow"), "+1415*\nnot a number");
    flushSync(() => $<HTMLButtonElement>('[data-calls-save="calls-settings"]')!.click());
    await settle();
    expect(puts()).toHaveLength(0);
    const alerts = [...host.querySelectorAll('[data-calls-form="calls-settings"] [role="alert"]')].map((element) => element.textContent);
    expect(alerts).toEqual([
      "Enter the number with + and its country code, like +14155550123.",
      "Enter an address that starts with https://.",
      "Enter a whole number of minutes from 1 to 60.",
      "Each line needs a number with + and its country code, or a prefix ending in *, like +1415*.",
    ]);
    expect(field("callerId").getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps Save off until something changes", async () => {
    await render();
    expect(voiceSave().disabled).toBe(true);
    type(field("voice"), "cedar");
    expect(voiceSave().disabled).toBe(false);
  });
});

describe("Voice settings", () => {
  it("shows the fields of the chosen turn detection, and saves the whole of it", async () => {
    await render();
    expect(field("transcriptionModel").value).toBe("gpt-4o-mini-transcribe");
    expect(field("threshold").value).toBe("0.5");
    expect(field("silenceDurationMs").value).toBe("500");
    expect($('[data-calls-form] [name="eagerness"]')).toBeNull();
    choose($<HTMLSelectElement>('[data-calls-form] [name="turnType"]')!, "semantic_vad");
    expect($('[data-calls-form] [name="threshold"]')).toBeNull();
    expect($('[data-calls-form] [name="silenceDurationMs"]')).toBeNull();
    choose($<HTMLSelectElement>('[data-calls-form] [name="eagerness"]')!, "high");
    choose($<HTMLSelectElement>('[data-calls-form] [name="noiseReduction"]')!, "far_field");
    type(field("maxTurnsWithoutReply"), "5");
    flushSync(() => voiceSave().click());
    await settle();
    expect(puts()).toHaveLength(1);
    expect(JSON.parse(puts()[0]![1].body)).toEqual({ calls: {
      turnDetection: { type: "semantic_vad", eagerness: "high" }, noiseReduction: "far_field", maxTurnsWithoutReply: 5,
    } });
  });

  it("refuses turn detection and loop guard values out of range, without saving", async () => {
    await render();
    type(field("threshold"), "2");
    type(field("silenceDurationMs"), "20");
    type(field("maxTurnsWithoutReply"), "0");
    flushSync(() => voiceSave().click());
    await settle();
    expect(puts()).toHaveLength(0);
    const alerts = [...host.querySelectorAll('[data-calls-form="calls-voice"] [role="alert"]')].map((element) => element.textContent);
    expect(alerts).toEqual([
      "Enter a number from 0 to 1.",
      "Enter a whole number of milliseconds from 100 to 5000.",
      "Enter a whole number from 1 to 10.",
    ]);
  });
});

describe("What the call says", () => {
  it("shows every text as calls use it now, in order, with its role and whether it is custom", async () => {
    await render();
    const keys = [...host.querySelectorAll<HTMLElement>("[data-calls-prompt]")].map((element) => element.dataset.callsPrompt);
    expect(keys).toEqual([...CALL_PROMPT_KEYS]);
    expect(prompt("disclosure").value).toBe("Default disclosure for {callee}.");
    expect(prompt("opening").value).toBe("Greet {callee} and say why you're calling.");
    expect($('[data-calls-prompt="opening"] [data-calls-prompt-state]')?.textContent).toBe("Custom");
    expect($('[data-calls-prompt="goodbye"] [data-calls-prompt-state]')?.textContent).toBe("Default");
    expect($('[data-calls-prompt="defaultBrief"]')?.textContent).toContain("Used as {brief} when a bot placed a call without one.");
    expect($('[data-calls-prompt="goodbye"] [data-calls-prompt-reset]')).toBeNull();
    expect(host.textContent).toContain("Calls use these texts exactly as saved, with nothing added.");
    const legend = $("[data-calls-placeholders]")!.textContent!;
    expect(legend).toContain("{onBehalfOf}");
    expect(legend).toContain("{maxMinutes}The call's time limit in minutes.");
  });

  it("saves only the text that changed, exactly as typed", async () => {
    await render();
    expect($<HTMLButtonElement>("[data-calls-prompts-save]")!.disabled).toBe(true);
    type(prompt("goodbye"), "Thank {callee}, say goodbye and hang up.\n");
    flushSync(() => $<HTMLButtonElement>("[data-calls-prompts-save]")!.click());
    await settle();
    expect(puts()).toHaveLength(1);
    expect(JSON.parse(puts()[0]![1].body)).toEqual({ calls: { goodbye: "Thank {callee}, say goodbye and hang up.\n" } });
    expect($<HTMLButtonElement>("[data-calls-prompts-save]")!.disabled).toBe(true);
  });

  it("resets a custom text to its default with null", async () => {
    await render();
    flushSync(() => $<HTMLButtonElement>('[data-calls-prompt-reset="opening"]')!.click());
    await settle();
    expect(puts()).toHaveLength(1);
    expect(JSON.parse(puts()[0]![1].body)).toEqual({ calls: { opening: null } });
    expect(prompt("opening").value).toBe("Default opening.");
  });

  it("shows the tools as sent, read-only", async () => {
    await render();
    const tools = $("[data-calls-tools]")!;
    expect(tools.tagName).toBe("PRE");
    expect(JSON.parse(tools.textContent!)).toEqual(READY.tools);
    expect(tools.closest("form")).toBeNull();
    expect(host.textContent).toContain("Sent to OpenAI as-is.");
  });
});

describe("Call history", () => {
  it("lists each call with who was called, the bot, when, how long and how it ended", async () => {
    await render();
    const rows = [...host.querySelectorAll<HTMLElement>("[data-call-row]")];
    expect(rows.map((element) => element.dataset.callRow)).toEqual(["c2", "c1"]);
    const ended = host.querySelector('[data-settings-disclosure="call-c1"]')!.textContent!;
    expect(ended).toContain("Dr. Lee's office · +14155550199");
    expect(ended).toContain("Ada");
    expect(ended).toContain("The call ended.");
    expect(ended).toContain("1:30");
    expect(host.querySelector('[data-settings-disclosure="call-c2"]')!.textContent).toContain("On the call");
  });

  it("opens a call's brief and transcript, labelled by speaker and timed from the answer", async () => {
    await render();
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-settings-disclosure="call-c1"] button')!.click());
    await settle();
    const detail = $("[data-call-detail]")!;
    expect(detail.textContent).toContain("Book a cleaning for Tuesday morning.");
    const lines = [...detail.querySelectorAll<HTMLElement>("[data-call-transcript] li")];
    expect(lines.map((line) => line.dataset.speaker)).toEqual(["note", "bot", "callee"]);
    expect(lines.map((line) => line.textContent)).toEqual([
      "0:00This call is from an AI assistant.",
      "0:05Ada Hi, I'm calling to book a cleaning.…",
      "1:05Dr. Lee's office Tuesday at nine works.",
    ]);
    expect(lines[1]!.querySelector("[data-call-cut]")?.getAttribute("aria-label")).toBe("Cut off");
    expect(lines[2]!.querySelector("[data-call-cut]")).toBeNull();
    expect(detail.querySelector("[data-call-hang-up]")).toBeNull();
  });

  it("shows what was sent for the call, folded until opened", async () => {
    await render();
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-settings-disclosure="call-c1"] button')!.click());
    await settle();
    const sent = $("[data-call-sent]")!;
    const toggle = sent.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    expect(toggle.textContent).toBe("What was sent");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(sent.querySelector<HTMLElement>(`#${CSS.escape(toggle.getAttribute("aria-controls")!)}`)!.hidden).toBe(true);
    flushSync(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const texts = [...sent.querySelectorAll<HTMLElement>("[data-call-sent-text]")];
    expect(texts.map((element) => element.dataset.callSentText)).toEqual(["disclosure", "instructions", "opening", "wrapUp", "goodbye"]);
    expect(texts[1]!.querySelector("pre")!.textContent).toBe("You are calling Dr. Lee's office for Sam.");
    const values = sent.querySelector("[data-call-sent-values]")!.textContent!;
    expect(values).toContain("gpt-4o-mini-transcribe");
    expect(values).toContain("By meaning (semantic VAD) · Eagerness Low");
    expect(values).toContain("Far (speakerphone)");
    expect(JSON.parse(sent.querySelector("[data-call-sent-session]")!.textContent!)).toEqual(DETAIL.sent!.session);
  });

  it("hangs up a call that hasn't ended", async () => {
    await render();
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-settings-disclosure="call-c2"] button')!.click());
    await settle();
    expect($("[data-call-detail]")!.textContent).toContain("Nothing was said on this call.");
    flushSync(() => $<HTMLButtonElement>("[data-call-hang-up]")!.click());
    await settle();
    expect(fx.api).toHaveBeenCalledWith("/api/calls/c2/hang-up", { method: "POST" });
  });

  it("says when there are no calls yet", async () => {
    calls = [];
    await render();
    expect(host.textContent).toContain("No calls yet.");
  });
});
