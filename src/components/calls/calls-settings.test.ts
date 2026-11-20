import { describe, expect, it } from "vitest";
import { CALL_PLACEHOLDERS, CALL_PROMPT_KEYS, type CallsSetup } from "../../../shared/phone-calls";
import {
  END_TEXT, PLACEHOLDER_MEANING, callsPatch, draftFrom, keepEdits, lineOffset, promptDraftFrom, promptsPatch, recordingDownloadUrl, splitRules, turnFieldShown, type CallsDraft,
} from "./calls-settings";

const prompts = Object.fromEntries(CALL_PROMPT_KEYS.map((key) => [key, { value: `${key} text`, default: `${key} text`, custom: false }])) as CallsSetup["prompts"];
const setup: CallsSetup = {
  ready: true, missing: [], problems: [], provider: "twilio", callerId: "+14155550123", publicUrl: "https://calls.example.com",
  maxMinutes: 10, model: "gpt-realtime-2.1-mini", voice: "marin", allow: ["+1415*"], deny: [], port: 8805, listening: true,
  transcriptionModel: "gpt-4o-mini-transcribe", turnDetection: { type: "server_vad", threshold: 0.5, prefixPaddingMs: 300, silenceDurationMs: 500 },
  noiseReduction: "near_field", maxTurnsWithoutReply: 3, record: true, prompts, tools: [],
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

  it("splits rules on lines and commas", () => {
    expect(splitRules(" +1415*,+44*\n +12125550100 \n")).toEqual(["+1415*", "+44*", "+12125550100"]);
  });
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
