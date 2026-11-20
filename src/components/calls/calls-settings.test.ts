import { describe, expect, it } from "vitest";
import { callsPatch, draftFrom, lineOffset, splitRules, type CallsDraft } from "./calls-settings";

const saved: CallsDraft = draftFrom({
  ready: true, missing: [], problems: [], provider: "twilio", callerId: "+14155550123", publicUrl: "https://calls.example.com",
  maxMinutes: 10, model: "gpt-realtime-2.1-mini", voice: "marin", allow: ["+1415*"], deny: [], port: 8805, listening: true,
});

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

  it("splits rules on lines and commas", () => {
    expect(splitRules(" +1415*,+44*\n +12125550100 \n")).toEqual(["+1415*", "+44*", "+12125550100"]);
  });
});

it("times a transcript line from the answer, or from dialing when nobody answered", () => {
  expect(lineOffset({ createdAt: 0, answeredAt: 10_000 }, 75_000)).toBe("1:05");
  expect(lineOffset({ createdAt: 0 }, 9_400)).toBe("0:09");
});
