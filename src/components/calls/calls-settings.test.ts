import { describe, expect, it } from "vitest";
import { CALL_PLACEHOLDERS, CALL_PROMPT_KEYS, type CallsSetup } from "../../../shared/phone-calls";
import {
  END_TEXT, PLACEHOLDER_MEANING, callsPatch, draftChanged, draftFrom, keepEdits, modelPrices, onBehalfOfNudge, voiceOptions, lineOffset, promptDraftFrom, promptsPatch, recordingDownloadUrl, splitRules, turnFieldShown, type CallsDraft,
} from "./calls-settings";

const prompts = Object.fromEntries(CALL_PROMPT_KEYS.map((key) => [key, { value: `${key} text`, default: `${key} text`, custom: false }])) as CallsSetup["prompts"];
const setup: CallsSetup = {
  ready: true, missing: [], problems: [], provider: "twilio", callerId: "+14155550123", publicUrl: "https://calls.example.com",
  maxMinutes: 10, model: "gpt-realtime-2.1-mini", voice: "marin", allow: ["+1415*"], deny: [], port: 8805, listening: true,
  transcriptionModel: "gpt-4o-mini-transcribe", turnDetection: { type: "server_vad", threshold: 0.5, prefixPaddingMs: 300, silenceDurationMs: 500 },
  noiseReduction: "near_field", maxTurnsWithoutReply: 3, record: true, reasoningEffort: "low", onBehalfOfDefault: "Sam Rivera", prompts, tools: [],
};
const saved: CallsDraft = draftFrom(setup);

describe("the calls patch", () => {
  it("sends nothing when nothing changed", () => {
    expect(callsPatch({ ...saved, voice: " marin " }, saved)).toEqual({ ok: true, calls: {} });
  });

  it("normalises numbers and addresses, and deletes cleared fields with null", () => {
    const draft = { ...saved, callerId: "", maxMinutes: "25", model: "", allow: "+1 (212) 555-0100, +44*\n\n" };
    expect(callsPatch(draft, saved)).toEqual({ ok: true, calls: { callerId: null, maxMinutes: 25, model: null, allow: ["+12125550100", "+44*"] } });
    expect(callsPatch({ ...saved, publicUrl: "https://calls.example.com/omb/" }, saved)).toEqual({ ok: true, calls: { publicUrl: "https://calls.example.com/omb" } });
    expect(callsPatch({ ...saved, allow: "" }, saved)).toEqual({ ok: true, calls: { allow: null } });
  });

  it("names each wrong field instead of saving", () => {
    const result = callsPatch({ ...saved, callerId: "555 0100", publicUrl: "http://calls.example.com", maxMinutes: "0", deny: "+1900*, 1900" }, saved);
    expect(result).toEqual({ ok: false, invalid: {
      callerId: "settings.calls.callerIdInvalid", publicUrl: "settings.calls.publicUrlInvalid", maxMinutes: "settings.calls.maxMinutesInvalid", deny: "settings.calls.ruleInvalid",
    } });
    expect(callsPatch({ ...saved, maxMinutes: "61" }, saved).ok).toBe(false);
    expect(callsPatch({ ...saved, maxMinutes: "2.5" }, saved).ok).toBe(false);
  });

  it("sends the whole turn detection when any part of it changes, and only the fields of its type", () => {
    expect(callsPatch({ ...saved, silenceDurationMs: "800" }, saved)).toEqual({ ok: true, calls: {
      turnDetection: { type: "server_vad", threshold: 0.5, prefixPaddingMs: 300, silenceDurationMs: 800 },
    } });
    expect(callsPatch({ ...saved, turnType: "semantic_vad", eagerness: "low" }, saved)).toEqual({ ok: true, calls: {
      turnDetection: { type: "semantic_vad", eagerness: "low" },
    } });
    expect(callsPatch({ ...saved, threshold: "" }, saved)).toEqual({ ok: true, calls: {
      turnDetection: { type: "server_vad", prefixPaddingMs: 300, silenceDurationMs: 500 },
    } });
    expect(turnFieldShown("threshold", "semantic_vad")).toBe(false);
    expect(turnFieldShown("eagerness", "semantic_vad")).toBe(true);
    expect(turnFieldShown("eagerness", "server_vad")).toBe(false);
    expect(turnFieldShown("model", "semantic_vad")).toBe(true);
  });

  it("refuses turn detection, loop guard and model values out of range", () => {
    expect(callsPatch({ ...saved, threshold: "1.5", prefixPaddingMs: "2001", silenceDurationMs: "50" }, saved)).toEqual({ ok: false, invalid: {
      threshold: "settings.calls.thresholdInvalid", prefixPaddingMs: "settings.calls.prefixPaddingInvalid", silenceDurationMs: "settings.calls.silenceInvalid",
    } });
    expect(callsPatch({ ...saved, silenceDurationMs: "250.5" }, saved).ok).toBe(false);
    expect(callsPatch({ ...saved, maxTurnsWithoutReply: "11" }, saved)).toEqual({ ok: false, invalid: { maxTurnsWithoutReply: "settings.calls.maxTurnsInvalid" } });
    expect(callsPatch({ ...saved, maxTurnsWithoutReply: "4", noiseReduction: "off" }, saved)).toEqual({ ok: true, calls: { maxTurnsWithoutReply: 4, noiseReduction: "off" } });
    expect(callsPatch({ ...saved, voice: "Marin" }, saved)).toEqual({ ok: false, invalid: { voice: "settings.calls.voiceInvalid" } });
    expect(callsPatch({ ...saved, transcriptionModel: "whisper 1" }, saved)).toEqual({ ok: false, invalid: { transcriptionModel: "settings.calls.modelInvalid" } });
    expect(callsPatch({ ...saved, transcriptionModel: "" }, saved)).toEqual({ ok: true, calls: { transcriptionModel: null } });
  });

  it("saves a reasoning effort, and the default low as null", () => {
    expect(callsPatch({ ...saved, reasoningEffort: "high" }, saved)).toEqual({ ok: true, calls: { reasoningEffort: "high" } });
    const high = { ...saved, reasoningEffort: "high" as const };
    expect(callsPatch({ ...high, reasoningEffort: "low" }, high)).toEqual({ ok: true, calls: { reasoningEffort: null } });
  });

  it("saves the model picked from the list, and picking Custom alone changes nothing", () => {
    expect(draftFrom(setup).modelChoice).toBe("gpt-realtime-2.1-mini");
    expect(draftFrom({ ...setup, model: "gpt-realtime" }).modelChoice).toBe("custom");
    expect(callsPatch({ ...saved, modelChoice: "gpt-realtime-2.1", model: "gpt-realtime-2.1" }, saved)).toEqual({ ok: true, calls: { model: "gpt-realtime-2.1" } });
    expect(draftChanged({ ...saved, modelChoice: "custom" }, saved)).toBe(false);
    expect(callsPatch({ ...saved, modelChoice: "custom" }, saved)).toEqual({ ok: true, calls: {} });
  });

  it("splits rules on lines and commas", () => {
    expect(splitRules(" +1415*,+44*\n +12125550100 \n")).toEqual(["+1415*", "+44*", "+12125550100"]);
  });
});

it("prices a model's audio per 1M tokens and per minute", () => {
  expect(modelPrices({ audioIn: 10, audioOut: 20 }, "en-US")).toEqual({ audioIn: "$10", audioOut: "$20", listening: "$0.006", speaking: "$0.024" });
  expect(modelPrices({ audioIn: 32, audioOut: 64 }, "en-US")).toEqual({ audioIn: "$32", audioOut: "$64", listening: "$0.019", speaking: "$0.077" });
});

it("offers the built-in voices, recommended first, and keeps a saved one that isn't listed", () => {
  expect(voiceOptions("marin").slice(0, 3)).toEqual([{ value: "marin", recommended: true }, { value: "cedar", recommended: true }, { value: "alloy", recommended: false }]);
  expect(voiceOptions("juniper")[0]).toEqual({ value: "juniper", recommended: false });
  expect(voiceOptions("")).toHaveLength(10);
});

it("nudges for a Calls on behalf of name only while it is empty", () => {
  expect(onBehalfOfNudge({ onBehalfOf: "Sam", onBehalfOfDefault: "Sam Rivera" })).toBeNull();
  expect(onBehalfOfNudge({ onBehalfOfDefault: "Sam Rivera" })).toBe("profile");
  expect(onBehalfOfNudge({ onBehalfOf: " ", onBehalfOfDefault: "the person I work for" })).toBe("standIn");
});

it("times a transcript line from the answer, or from dialing when nobody answered", () => {
  expect(lineOffset({ createdAt: 0, answeredAt: 10_000 }, 75_000)).toBe("1:05");
  expect(lineOffset({ createdAt: 0 }, 9_400)).toBe("0:09");
});

describe("the call texts", () => {
  const texts = promptDraftFrom(setup);

  it("sends only the changed texts exactly as typed, and an emptied one as null", () => {
    expect(promptsPatch({ ...texts, opening: "  Say hi to {callee}.\n" }, texts)).toEqual({ ok: true, calls: { opening: "  Say hi to {callee}.\n" } });
    expect(promptsPatch({ ...texts, goodbye: "   " }, texts)).toEqual({ ok: true, calls: { goodbye: null } });
    expect(promptsPatch(texts, texts)).toEqual({ ok: true, calls: {} });
  });

  it("refuses a text over 12,000 characters", () => {
    expect(promptsPatch({ ...texts, instructions: "x".repeat(12_001) }, texts)).toEqual({ ok: false, invalid: { instructions: "settings.calls.promptTooLong" } });
  });
});

it("keeps unsaved edits when the saved values reload", () => {
  expect(keepEdits({ a: "new", b: "new" }, { a: "old", b: "old" }, { a: "old", b: "typed" })).toEqual({ a: "new", b: "typed" });
});

it("words the no_reply ending", () => {
  expect(END_TEXT.no_reply).toBe("server.calls.end.no_reply");
});

describe("call recordings and placeholders", () => {
  it("asks the recording route for a download", () => {
    expect(recordingDownloadUrl("/api/calls/c1/recording")).toBe("/api/calls/c1/recording?download=1");
    expect(recordingDownloadUrl("/api/calls/c1/recording?v=2")).toBe("/api/calls/c1/recording?v=2&download=1");
  });

  it("names every placeholder in the app's language", () => {
    expect(CALL_PLACEHOLDERS.filter(({ name }) => !PLACEHOLDER_MEANING[name]).map(({ name }) => name)).toEqual([]);
    expect(PLACEHOLDER_MEANING.recordingNotice).toBe("settings.calls.placeholder.recordingNotice");
  });
});
