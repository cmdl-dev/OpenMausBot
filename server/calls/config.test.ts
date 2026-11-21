import { describe, expect, it } from "vitest";
import { resolveCaller } from "./caller.ts";
import { e164, numberRefusal, numberRule } from "../../shared/phone-calls.ts";
import { callsConfigWithEnv, callsNotReadyText, callsOffered, callsSettings, callsSetup, publicBase } from "./config.ts";
import { callTexts, customPrompt, DEFAULT_CALL_PROMPTS, NOTHING_HEARD, phoneCallsPrompt, realName, renderTemplate, RETIRED_CALL_PROMPTS } from "./prompt.ts";
import { callPrompts } from "./config.ts";

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
      turnDetection: { type: "semantic_vad", eagerness: "auto" }, noiseReduction: "near_field", maxTurnsWithoutReply: 3, reasoningEffort: "low",
      prompts: DEFAULT_CALL_PROMPTS, record: true, disclosureEnabled: true,
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

describe("the bot's instructions about phone calls", () => {
  it("tell a bot with the call tools that it can phone people and where place_call is, and say nothing otherwise", () => {
    const told = phoneCallsPrompt({ agentsTools: true, offered: true, room: false });
    expect(told).toContain("place_call dials a number");
    expect(told).toContain("find it with your tool search");
    expect(told).toContain("never say you can't make phone calls");
    expect(phoneCallsPrompt({ agentsTools: true, offered: false, room: false })).toBe("");
    expect(phoneCallsPrompt({ agentsTools: false, offered: true, room: false })).toBe("");
    expect(phoneCallsPrompt({ agentsTools: true, offered: true, room: true })).toBe("");
    expect(phoneCallsPrompt({ agentsTools: true, offered: true, room: false, toolsOff: ["calls"] })).toBe("");
  });
});

describe("what a call says", () => {
  const CALL = { botName: "Iris", brief: "Ask how their day is going.", caller: resolveCaller({ onBehalfOf: "GrandStein" }, {}, undefined), to: "+15625550100", maxMinutes: 10, recorded: false, disclosureSpoken: true };

  it("never greets a stand-in name like \"You\" or a blank one", () => {
    for (const stand of ["You", " you ", "", "  ", "them", "Unknown", "N/A", "[name]", "the person"]) expect(realName(stand), stand).toBeUndefined();
    expect(realName("  Ann  Lee ")).toBe("Ann Lee");
    const texts = callTexts(DEFAULT_CALL_PROMPTS, { ...CALL, calleeName: "You" });
    expect(texts.instructions).toContain("You are speaking with the person you called at +15625550100.");
    expect(JSON.stringify(texts)).not.toMatch(/\bYou at\b|\{\w+\}/);
    expect(callTexts(DEFAULT_CALL_PROMPTS, { ...CALL, calleeName: "Luigi's" }).instructions).toContain("You are speaking with Luigi's at +15625550100.");
  });

  it("fills the disclosure and instructions from the call, and uses the default goal for an empty brief", () => {
    const texts = callTexts(DEFAULT_CALL_PROMPTS, { ...CALL, caller: resolveCaller({ onBehalfOf: "GrandStein", purpose: "book a haircut this Sunday" }, {}, undefined) });
    expect(texts.disclosure).toBe("Hi, this is an AI assistant calling for GrandStein. This call is transcribed.");
    expect(texts.instructions).toContain("You are an AI assistant making a phone call for GrandStein. You are calling a business or someone other than the person you represent.");
    expect(texts.instructions).toContain("Your goal: book a haircut this Sunday.");
    expect(texts.instructions).toContain("When they answered, they heard: \"Hi, this is an AI assistant calling for GrandStein. This call is transcribed.\"");
    expect(texts.instructions).toContain("# Brief\nAsk how their day is going.");
    expect(texts.instructions).toContain("- \"Who is this?\": \"I'm an AI assistant calling for GrandStein to book a haircut this Sunday.\"");
    expect(callTexts(DEFAULT_CALL_PROMPTS, { ...CALL, brief: "  " }).instructions).toContain("# Brief\nIntroduce yourself, say why you're calling, listen, and note anything worth passing on.");
  });

  it("says the call is recorded while recording is on, and follows the toggle in a saved text through {recordingNotice}", () => {
    expect(callTexts(DEFAULT_CALL_PROMPTS, { ...CALL, recorded: true }).disclosure).toBe("Hi, this is an AI assistant calling for GrandStein. This call is recorded.");
    expect(callTexts(DEFAULT_CALL_PROMPTS, CALL).disclosure).toBe("Hi, this is an AI assistant calling for GrandStein. This call is transcribed.");
    const custom = callPrompts({ disclosure: "Hello for {onBehalfOf}. {recordingNotice}" });
    expect(callTexts(custom, { ...CALL, recorded: true }).disclosure).toBe("Hello for GrandStein. This call is recorded.");
    expect(callTexts(callPrompts({ disclosure: "Exactly this." }), { ...CALL, recorded: true }).disclosure).toBe("Exactly this.");
    expect(callsSettings(FULL).ready?.record).toBe(true);
    expect(callsSettings({ ...FULL, calls: { ...FULL.calls, record: false } }).ready?.record).toBe(false);
    expect(callsSetup({ ...FULL, calls: { ...FULL.calls, record: false } }, true).record).toBe(false);
  });

  it("uses a saved text exactly as written, only its placeholders filled, and the default again once reset", () => {
    const saved = callPrompts({ instructions: "Talk like a pirate to {callee} about: {brief} {unknown}", opening: "Ahoy {calleeName}!" });
    const texts = callTexts(saved, { ...CALL, calleeName: "Ann" });
    expect(texts.instructions).toBe("Talk like a pirate to Ann about: Ask how their day is going. {unknown}");
    expect(texts.opening).toBe("Ahoy Ann!");
    expect(texts.disclosure).toBe("Hi, this is an AI assistant calling for GrandStein. This call is transcribed.");
    expect(callPrompts({ instructions: "   " }).instructions).toBe(DEFAULT_CALL_PROMPTS.instructions);
    expect(callPrompts({}).opening).toBe(DEFAULT_CALL_PROMPTS.opening);
    expect(renderTemplate("{a}{b}{a}", { a: 1, b: "x" })).toBe("1x1");
  });

  it("reports every text with its default and whether a saved one replaces it, plus the tool sent as-is", () => {
    const setup = callsSetup({ ...FULL, calls: { ...FULL.calls, goodbye: "Bye {callee}.", maxTurnsWithoutReply: 4, turnDetection: { type: "semantic_vad", eagerness: "low" } } }, true);
    expect(setup.prompts.goodbye).toEqual({ value: "Bye {callee}.", default: DEFAULT_CALL_PROMPTS.goodbye, custom: true });
    expect(setup.prompts.instructions).toEqual({ value: DEFAULT_CALL_PROMPTS.instructions, default: DEFAULT_CALL_PROMPTS.instructions, custom: false });
    expect(setup.prompts.openingOwner).toEqual({ value: DEFAULT_CALL_PROMPTS.openingOwner, default: DEFAULT_CALL_PROMPTS.openingOwner, custom: false });
    expect(setup).toMatchObject({ maxTurnsWithoutReply: 4, turnDetection: { type: "semantic_vad", eagerness: "low" }, noiseReduction: "near_field", transcriptionModel: "gpt-transcribe" });
    expect(setup.tools).toEqual([expect.objectContaining({ type: "function", name: "end_call", description: DEFAULT_CALL_PROMPTS.endCallDescription })]);
    expect(callsSetup({ ...FULL, calls: { ...FULL.calls, turnDetection: { type: "server_vad", threshold: 0.8 } } }, true).turnDetection)
      .toEqual({ type: "server_vad", threshold: 0.8, prefixPaddingMs: 300, silenceDurationMs: 700 });
  });
});

describe("whose behalf a call is on", () => {
  const CALL = { botName: "Iris", brief: "Book the haircut.", to: "+15625550100", maxMinutes: 10, recorded: true, disclosureSpoken: true };
  const SETTINGS = { userName: "Cesar H.", callbackNumber: "+15625550111", aboutMe: "Prefers mornings." };

  it("takes each name and number from the call, else About you, else the profile, and says where it came from", () => {
    expect(resolveCaller({ onBehalfOf: "Ana", bookingName: "Ana Ruiz", callbackNumber: "+15625550199", purpose: "book a haircut", details: "Sunday 10am or 11am" }, SETTINGS, "Profile Name")).toEqual({
      callType: "business", purpose: "book a haircut", userName: "Ana", userNameFrom: "call", bookingName: "Ana Ruiz", bookingNameFrom: "call",
      callbackNumber: "+15625550199", callbackNumberFrom: "call", details: "Sunday 10am or 11am\nAbout Ana: Prefers mornings.", aboutMeIncluded: true,
    });
    expect(resolveCaller({}, SETTINGS, "Profile Name")).toMatchObject({ userName: "Cesar H.", userNameFrom: "settings", bookingName: "Cesar H.", bookingNameFrom: "settings", callbackNumber: "+15625550111", callbackNumberFrom: "settings" });
    expect(resolveCaller({}, {}, "Profile Name")).toMatchObject({ userName: "Profile Name", userNameFrom: "profile", bookingName: "Profile Name", bookingNameFrom: "profile", callbackNumberFrom: "none" });
    expect(resolveCaller({ onBehalfOf: "You" }, {}, undefined)).toEqual({ callType: "business", userNameFrom: "none", bookingNameFrom: "none", callbackNumberFrom: "none", aboutMeIncluded: false });
    expect(resolveCaller({ callType: "owner" }, {}, undefined).callType).toBe("owner");
  });

  it("with no name anywhere calls \"for a client\", leaves the name lines empty, and never says the old stand-in", () => {
    const texts = callTexts(DEFAULT_CALL_PROMPTS, { ...CALL, caller: resolveCaller({ purpose: "book a haircut this Sunday" }, {}, undefined) });
    expect(texts.disclosure).toBe("Hi, this is an AI assistant calling for a client. This call is recorded.");
    expect(texts.opening).toBe("Say why you're calling in one short, friendly sentence, for example \"Hi! I'm calling to book a haircut this Sunday for a client.\" Then ask your first question.");
    expect(texts.instructions).toContain("- Name to give: . If no name is listed, say you're calling for a client and don't invent one.");
    const everything = JSON.stringify(texts);
    expect(everything).not.toContain("the person I work for");
    expect(everything).not.toMatch(/\{\w+\}/);
    for (const key of Object.keys(DEFAULT_CALL_PROMPTS) as Array<keyof typeof DEFAULT_CALL_PROMPTS>) expect(DEFAULT_CALL_PROMPTS[key], key).not.toContain("the person I work for");
  });

  it("opens a business call with its purpose and an owner call by name, from two editable texts", () => {
    const business = callTexts(DEFAULT_CALL_PROMPTS, { ...CALL, caller: resolveCaller({ onBehalfOf: "Cesar", purpose: "book a haircut this Sunday" }, {}, undefined) });
    expect(business.opening).toBe("Say why you're calling in one short, friendly sentence, for example \"Hi! I'm calling to book a haircut this Sunday for Cesar.\" Then ask your first question.");
    const owner = callTexts(DEFAULT_CALL_PROMPTS, { ...CALL, caller: resolveCaller({ onBehalfOf: "Cesar", purpose: "remind you about the dentist", callType: "owner" }, {}, undefined) });
    expect(owner.opening).toBe("Greet Cesar by name if you have it, say in one sentence why you're calling (remind you about the dentist), and ask your first question.");
    expect(owner.instructions).toContain("You are calling the person you represent themselves, not a business.");
    expect(callTexts(callPrompts({ openingOwner: "Hey {userName}!" }), { ...CALL, caller: resolveCaller({ onBehalfOf: "Cesar", callType: "owner" }, {}, undefined) }).opening).toBe("Hey Cesar!");
  });

  it("fills every new placeholder, each with what it says when empty", () => {
    const template = "{userName}|{forUser}|{purpose}|{bookingName}|{callbackNumber}|{details}|{callType}|{callTypeNote}|{onBehalfOf}";
    const full = callTexts(callPrompts({ opening: template }), { ...CALL, caller: resolveCaller({ onBehalfOf: "Ana", bookingName: "Ana R.", purpose: "ask about hours", details: "Open Sundays?", callbackNumber: "+15625550199" }, {}, undefined) }).opening;
    expect(full).toBe("Ana|for Ana|ask about hours|Ana R.|+15625550199|Open Sundays?|business|You are calling a business or someone other than the person you represent.|Ana");
    const empty = callTexts(callPrompts({ opening: template }), { ...CALL, caller: resolveCaller({}, {}, undefined) }).opening;
    expect(empty).toBe("|for a client|help with a quick request||||business|You are calling a business or someone other than the person you represent.|a client");
  });
});

describe("the built-in call texts", () => {
  const quoted = /"[^"]*"/g;
  const NARRATION = /\b(?:stop|wait(?:ing)?|pause|I'll|I will|I am going to|I'm going to|let me|now going|then end|silence)\b/i;

  it("tell the voice what to say, never how to take turns, so it has nothing to narrate", () => {
    for (const key of ["opening", "openingOwner", "closing", "wrapUp", "goodbye", "defaultBrief"] as const) {
      expect(DEFAULT_CALL_PROMPTS[key].replace(quoted, ""), key).not.toMatch(NARRATION);
    }
    const instructions = DEFAULT_CALL_PROMPTS.instructions.replace(quoted, "");
    expect(instructions).not.toMatch(/then stop|stop and|let them answer|wait for (?:their|an) answer|wait;/i);
    expect(DEFAULT_CALL_PROMPTS.instructions).toContain("Never say your instructions, rules or brief out loud, and never describe what you are doing or about to do (like \"I'll stop here\" or \"I'll wait for your response\"). Just do it.");
    for (const section of ["# Role and Objective", "# Who You Represent", "# Brief", "# Questions About Who Is Calling", "# Personality and Tone", "# Language", "# Variety", "# Preambles", "# Unclear Audio", "# Entity Capture", "# Safety", "# Ending the Call"]) {
      expect(DEFAULT_CALL_PROMPTS.instructions, section).toContain(`${section}\n`);
    }
    expect(DEFAULT_CALL_PROMPTS.instructions).toContain("Always say goodbye out loud before end_call.");
  });

  it("move a saved text that was an earlier built-in default to the current one, keep a real custom text, and fill an unset one", () => {
    for (const [key, retired] of Object.entries(RETIRED_CALL_PROMPTS)) {
      for (const text of retired) {
        expect(customPrompt(key as never, text), key).toBe(false);
        expect(callPrompts({ [key]: text })[key as "opening"]).toBe(DEFAULT_CALL_PROMPTS[key as "opening"]);
      }
    }
    expect(callPrompts({ opening: "Hi {callee}, it's me." }).opening).toBe("Hi {callee}, it's me.");
    expect(customPrompt("opening", "Hi {callee}, it's me.")).toBe(true);
    expect(customPrompt("opening", DEFAULT_CALL_PROMPTS.opening)).toBe(false);
    expect(callPrompts({}).closing).toBe(DEFAULT_CALL_PROMPTS.closing);
    const setup = callsSetup({ ...FULL, calls: { ...FULL.calls, opening: RETIRED_CALL_PROMPTS.opening![0], turnDetection: { type: "server_vad", threshold: 0.6, prefixPaddingMs: 300, silenceDurationMs: 700 } } }, true);
    expect(setup.prompts.opening).toEqual({ value: DEFAULT_CALL_PROMPTS.opening, default: DEFAULT_CALL_PROMPTS.opening, custom: false });
    expect(setup.turnDetection).toEqual({ type: "semantic_vad", eagerness: "auto" });
    expect(callsSetup({ ...FULL, calls: { ...FULL.calls, turnDetection: { type: "server_vad", threshold: 0.7 } } }, true).turnDetection)
      .toEqual({ type: "server_vad", threshold: 0.7, prefixPaddingMs: 300, silenceDurationMs: 700 });
  });

  it("defaults to the cheaper realtime model, marin, semantic VAD and low reasoning, and says who the call is for when no name is set", () => {
    expect(callsSetup(FULL, true)).toMatchObject({ model: "gpt-realtime-2.1-mini", voice: "marin", turnDetection: { type: "semantic_vad", eagerness: "auto" }, reasoningEffort: "low", nameDefault: { name: "", from: "none" } });
    expect(callsSetup({ ...FULL, profile: { name: "GrandStein" } }, true).nameDefault).toEqual({ name: "GrandStein", from: "profile" });
    expect(callsSetup({ ...FULL, profile: { name: "GrandStein" }, calls: { ...FULL.calls, onBehalfOf: "Cesar" } }, true).nameDefault).toEqual({ name: "Cesar", from: "settings" });
    expect(callsSetup({ ...FULL, calls: { ...FULL.calls, onBehalfOf: "Cesar", userName: "Cesar H." } }, true).nameDefault).toEqual({ name: "Cesar H.", from: "settings" });
    expect(callsSetup({ ...FULL, calls: { ...FULL.calls, reasoningEffort: "minimal" } }, true).reasoningEffort).toBe("minimal");
  });
});

describe("turning the spoken disclosure off", () => {
  const CALL = { botName: "Iris", brief: "Ask how their day is going.", caller: resolveCaller({ onBehalfOf: "GrandStein" }, {}, undefined), to: "+15625550100", maxMinutes: 10, recorded: true };

  it("is on unless turned off, and setup says which", () => {
    expect(callsSettings(FULL).ready?.disclosureEnabled).toBe(true);
    expect(callsSetup(FULL, true).disclosureEnabled).toBe(true);
    expect(callsSetup({ ...FULL, calls: { ...FULL.calls, disclosureEnabled: false } }, true).disclosureEnabled).toBe(false);
  });

  it("tells the voice what the callee heard only when Twilio said it", () => {
    const spoken = callTexts(DEFAULT_CALL_PROMPTS, { ...CALL, disclosureSpoken: true });
    expect(spoken.instructions).toContain("- When they answered, they heard: \"Hi, this is an AI assistant calling for GrandStein. This call is recorded.\" Don't repeat it.");
    const silent = callTexts(DEFAULT_CALL_PROMPTS, { ...CALL, disclosureSpoken: false });
    expect(silent.instructions).toContain(`- ${NOTHING_HEARD}`);
    expect(silent.instructions).not.toMatch(/they heard/i);
    expect(DEFAULT_CALL_PROMPTS.instructions).toContain("\n- {disclosureHeard}\n");
  });

  it("puts no disclosure in a default opening, and lets a saved opening say it itself", () => {
    for (const key of ["opening", "openingOwner", "closing", "wrapUp", "goodbye", "defaultBrief", "endCallDescription"] as const) expect(DEFAULT_CALL_PROMPTS[key], key).not.toMatch(/\{(?:disclosure|recordingNotice|disclosureHeard)\}/);
    const opening = callTexts(callPrompts({ opening: "Say: {disclosure} Then mention: {recordingNotice}" }), { ...CALL, disclosureSpoken: false }).opening;
    expect(opening).toBe("Say: Hi, this is an AI assistant calling for GrandStein. This call is recorded. Then mention: This call is recorded.");
  });

  it("moves a saved copy of any earlier default instructions to the current one", () => {
    expect(RETIRED_CALL_PROMPTS.instructions!.length).toBe(3);
    for (const previous of RETIRED_CALL_PROMPTS.instructions!) {
      expect(customPrompt("instructions", previous)).toBe(false);
      expect(callPrompts({ instructions: previous }).instructions).toBe(DEFAULT_CALL_PROMPTS.instructions);
    }
  });
});
