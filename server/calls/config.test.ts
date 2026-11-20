import { describe, expect, it } from "vitest";
import { e164, numberRefusal, numberRule } from "../../shared/phone-calls.ts";
import { callsConfigWithEnv, callsNotReadyText, callsOffered, callsSettings, callsSetup, publicBase } from "./config.ts";

const SID = `AC${"a".repeat(32)}`;
const FULL = { calls: { accountSid: SID, authToken: "token-123", callerId: "+1 (415) 555-0100", publicUrl: "https://calls.example.com/" }, openai: { key: "sk-test" } };

describe("phone call settings", () => {
  it("names exactly the settings that are missing, with where to set them, and starts with none of them", () => {
    const none = callsSettings({});
    expect(none.ready).toBeNull();
    expect(none.missing.map((setting) => setting.id)).toEqual(["twilioAccountSid", "twilioAuthToken", "callerId", "openaiKey", "publicUrl"]);
    expect(callsNotReadyText({})).toBe(
      "Phone calls aren't set up yet. Missing: Settings → API keys → Twilio Account SID (or OMB_TWILIO_ACCOUNT_SID); Settings → API keys → Twilio auth token (or OMB_TWILIO_AUTH_TOKEN); "
      + "Settings → Phone calls → Caller ID number (or OMB_CALLS_CALLER_ID); Settings → API keys → OpenAI (or OMB_OPENAI_API_KEY); Settings → Phone calls → Public address (or OMB_CALLS_PUBLIC_URL).",
    );
    expect(callsSettings({ calls: { accountSid: SID, callerId: "+14155550100" } }).missing.map((setting) => setting.id)).toEqual(["twilioAuthToken", "openaiKey", "publicUrl"]);
    expect(callsOffered({})).toBe(false);
    expect(callsOffered({ calls: { callerId: "+14155550100" } })).toBe(true);
  });

  it("is ready with every setting, normalizing the caller ID and the public address, with the defaults", () => {
    expect(callsSettings(FULL).ready).toEqual({
      accountSid: SID, authToken: "token-123", callerId: "+14155550100", publicUrl: "https://calls.example.com", openaiKey: "sk-test",
      maxMinutes: 10, model: "gpt-realtime-2.1-mini", voice: "marin", transcriptionModel: "gpt-transcribe", allow: [], deny: [],
    });
    expect(callsNotReadyText(FULL)).toBeNull();
  });

  it("reuses a Live-calls key saved for OpenAI when there is no OpenAI API key", () => {
    const live = { ...FULL, openai: {}, live: { key: "sk-live", keyFor: "openai" } };
    expect(callsSettings(live).ready?.openaiKey).toBe("sk-live");
    expect(callsSettings({ ...live, live: { key: "az-key", keyFor: "azure:x.openai.azure.com", provider: "azure" as const, azureEndpoint: "https://x.openai.azure.com" } }).missing.map((setting) => setting.id)).toEqual(["openaiKey"]);
  });

  it("says which saved settings are wrong", () => {
    const wrong = callsSettings({ ...FULL, calls: { ...FULL.calls, accountSid: "SK123", callerId: "4155550100", publicUrl: "http://calls.example.com", deny: ["+1900*", "nope"] } });
    expect(wrong.ready).toBeNull();
    expect(wrong.problems).toEqual([
      "The Twilio Account SID should start with AC followed by 32 letters and digits.",
      "The caller ID number must be in E.164 form, like +14155550123.",
      "The public address must be an https:// URL with nothing after ? or #.",
      "\"nope\" in the denylist isn't an E.164 number or a prefix ending in *.",
    ]);
  });

  it("takes every OMB_* override over config.json", () => {
    const env = {
      OMB_TWILIO_ACCOUNT_SID: SID, OMB_TWILIO_AUTH_TOKEN: "env-token", OMB_CALLS_CALLER_ID: "+442071234567", OMB_CALLS_PUBLIC_URL: "https://env.example.com",
      OMB_CALLS_MAX_MINUTES: "5", OMB_CALLS_REALTIME_MODEL: "gpt-realtime-2.1", OMB_CALLS_ALLOW: "+44*, +14155550100", OMB_CALLS_DENY: "+1900*", OMB_CALLS_PORT: "9123",
    };
    expect(callsConfigWithEnv({ callerId: "+15550000000", maxMinutes: 30 }, env)).toEqual({
      accountSid: SID, authToken: "env-token", callerId: "+442071234567", publicUrl: "https://env.example.com", maxMinutes: 5, model: "gpt-realtime-2.1",
      allow: ["+44*", "+14155550100"], deny: ["+1900*"], port: 9123,
    });
    expect(callsConfigWithEnv({ maxMinutes: 30 }, { OMB_CALLS_MAX_MINUTES: "500" }).maxMinutes).toBe(30);
  });

  it("reports the setup for the app without any secret", () => {
    const setup = callsSetup(FULL, true);
    expect(setup).toMatchObject({ ready: true, missing: [], problems: [], callerId: "+1 (415) 555-0100", publicUrl: "https://calls.example.com", maxMinutes: 10, port: 8805, listening: true });
    expect(JSON.stringify(setup)).not.toContain("token-123");
    expect(JSON.stringify(setup)).not.toContain("sk-test");
    expect(JSON.stringify(setup)).not.toContain(SID);
  });

  it("accepts only https public addresses without credentials, query or fragment", () => {
    expect(publicBase("https://a.example.com/omb/")).toBe("https://a.example.com/omb");
    for (const bad of ["http://a.example.com", "https://u:p@a.example.com", "https://a.example.com/?x=1", "https://a.example.com/#x", "nope", ""]) expect(publicBase(bad), bad).toBeNull();
  });
});

describe("numbers", () => {
  it("reads E.164 numbers and rules", () => {
    expect(e164("+1 (415) 555-0100")).toBe("+14155550100");
    for (const bad of ["4155550100", "+0123456789", "+1415", "911", "+1415555010012345"]) expect(e164(bad), bad).toBeNull();
    expect(numberRule("+44 *")).toBe("+44*");
    expect(numberRule("44*")).toBeNull();
  });

  it("refuses what the denylist names even when allowed, and anything the allowlist leaves out", () => {
    expect(numberRefusal("+14155550100", { allow: [], deny: [] })).toBeNull();
    expect(numberRefusal("+19005550100", { allow: ["+1*"], deny: ["+1900*"] })).toContain("denylist");
    expect(numberRefusal("+442071234567", { allow: ["+1*"], deny: [] })).toContain("isn't on the phone calls allowlist");
    expect(numberRefusal("+14155550100", { allow: ["+14155550100"], deny: [] })).toBeNull();
  });
});
