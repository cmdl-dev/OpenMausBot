import type { LocaleKey } from "@/locales";
import {
  CALL_PROMPT_KEYS, REALTIME_MODELS, REALTIME_VOICES, RECOMMENDED_VOICES, e164, numberRule, realtimeMinuteCost, type CallCaller, type CallDetail,
  type CallEndReason, type CallInfoSource, type CallNoiseReduction, type CallPromptKey, type CallReasoningEffort, type CallSent, type CallSetting, type CallsSetup,
  type CallSummary, type CallTurnDetection,
} from "../../../shared/phone-calls";

export type { CallCaller, CallDetail, CallLine, CallPromptKey, CallRecording, CallSent, CallSummary, CallTurnDetection } from "../../../shared/phone-calls";
export { CALL_PLACEHOLDERS, CALL_PROMPT_KEYS, CALL_REASONING_EFFORTS, REALTIME_MODELS } from "../../../shared/phone-calls";

export type CallsSetupStatus = CallsSetup;

export const CALLS_PATH = "/api/calls";

export const END_TEXT: Record<CallEndReason, LocaleKey> = {
  completed: "server.calls.end.completed",
  hung_up: "server.calls.end.hung_up",
  no_answer: "server.calls.end.no_answer",
  busy: "server.calls.end.busy",
  failed: "server.calls.end.failed",
  voicemail: "server.calls.end.voicemail",
  max_length: "server.calls.end.max_length",
  canceled: "server.calls.end.canceled",
  lost: "server.calls.end.lost",
  error: "server.calls.end.error",
  no_reply: "server.calls.end.no_reply",
};

export const SETTING_LABEL: Record<CallSetting["id"], LocaleKey> = {
  twilioAccountSid: "keys.label.twilioSid",
  twilioAuthToken: "keys.label.twilioToken",
  openaiKey: "keys.openai.label",
  callerId: "settings.calls.callerId",
  publicUrl: "settings.calls.publicUrl",
};

export type TurnType = CallTurnDetection["type"];
export type Eagerness = NonNullable<CallTurnDetection["eagerness"]>;

export const TURN_TYPES: readonly TurnType[] = ["semantic_vad", "server_vad"];
export const EAGERNESS: readonly Eagerness[] = ["auto", "low", "medium", "high"];
export const NOISE_REDUCTION: readonly CallNoiseReduction[] = ["near_field", "far_field", "off"];

export const TURN_TYPE_LABEL: Record<TurnType, LocaleKey> = {
  server_vad: "settings.calls.turnType.server_vad",
  semantic_vad: "settings.calls.turnType.semantic_vad",
};
export const EAGERNESS_LABEL: Record<Eagerness, LocaleKey> = {
  auto: "settings.calls.eagerness.auto",
  low: "settings.calls.eagerness.low",
  medium: "settings.calls.eagerness.medium",
  high: "settings.calls.eagerness.high",
};
export const NOISE_REDUCTION_LABEL: Record<CallNoiseReduction, LocaleKey> = {
  near_field: "settings.calls.noiseReduction.near_field",
  far_field: "settings.calls.noiseReduction.far_field",
  off: "settings.calls.noiseReduction.off",
};

export const CUSTOM_MODEL = "custom";

export const MODEL_TAG: Record<string, LocaleKey> = {
  "gpt-realtime-2.1-mini": "settings.calls.modelLowerCost",
  "gpt-realtime-2.1": "settings.calls.modelBest",
};

export function listedModel(id: string) {
  return REALTIME_MODELS.find((model) => model.id === id);
}

export function modelPrices(model: { audioIn: number; audioOut: number }, locale: string) {
  const dollars = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumSignificantDigits: 2 });
  const minute = realtimeMinuteCost(model);
  return { audioIn: dollars.format(model.audioIn), audioOut: dollars.format(model.audioOut), listening: dollars.format(minute.listening), speaking: dollars.format(minute.speaking) };
}

export function voiceOptions(current: string): Array<{ value: string; recommended: boolean }> {
  const listed: readonly string[] = REALTIME_VOICES;
  const voices = current && !listed.includes(current) ? [current, ...listed] : listed;
  return voices.map((value) => ({ value, recommended: RECOMMENDED_VOICES.has(value) }));
}

export const DEFAULT_REASONING_EFFORT: CallReasoningEffort = "low";

export const REASONING_LABEL: Record<CallReasoningEffort, LocaleKey> = {
  minimal: "settings.calls.reasoning.minimal",
  low: "settings.calls.reasoning.low",
  medium: "settings.calls.reasoning.medium",
  high: "settings.calls.reasoning.high",
};

export const ABOUT_YOU_LIMITS = {
  userName: { max: 80, wrong: "settings.calls.userNameTooLong" },
  callbackNumber: { max: 40, wrong: "settings.calls.callbackNumberTooLong" },
  aboutMe: { max: 2000, wrong: "settings.calls.aboutMeTooLong" },
} as const satisfies Record<string, { max: number; wrong: LocaleKey }>;

type AboutYouField = keyof typeof ABOUT_YOU_LIMITS;

export function emptyNameNote(nameDefault: CallsSetup["nameDefault"]): { key: LocaleKey; name: string } | null {
  if (nameDefault.from === "profile" && nameDefault.name.trim()) return { key: "settings.calls.userNameProfile", name: nameDefault.name };
  if (nameDefault.from === "none") return { key: "settings.calls.userNameNone", name: "" };
  return null;
}

export interface CallsDraft {
  callerId: string;
  publicUrl: string;
  maxMinutes: string;
  modelChoice: string;
  model: string;
  voice: string;
  reasoningEffort: CallReasoningEffort;
  transcriptionModel: string;
  turnType: TurnType;
  threshold: string;
  prefixPaddingMs: string;
  silenceDurationMs: string;
  eagerness: Eagerness;
  noiseReduction: CallNoiseReduction;
  maxTurnsWithoutReply: string;
  allow: string;
  deny: string;
  userName: string;
  callbackNumber: string;
  aboutMe: string;
}

export type DraftField = keyof CallsDraft;

const SERVER_VAD_FIELDS = ["threshold", "prefixPaddingMs", "silenceDurationMs"] as const;
const TURN_FIELDS: Record<TurnType, readonly DraftField[]> = { server_vad: SERVER_VAD_FIELDS, semantic_vad: ["eagerness"] };

export function turnFieldShown(field: DraftField, type: TurnType): boolean {
  const owner = TURN_TYPES.find((each) => TURN_FIELDS[each].includes(field));
  return !owner || owner === type;
}

const optionalNumber = (value: number | undefined) => (value === undefined ? "" : String(value));

export function draftFrom(setup: CallsSetupStatus): CallsDraft {
  return {
    callerId: setup.callerId ?? "",
    publicUrl: setup.publicUrl ?? "",
    maxMinutes: String(setup.maxMinutes),
    modelChoice: listedModel(setup.model) ? setup.model : CUSTOM_MODEL,
    model: setup.model,
    voice: setup.voice,
    reasoningEffort: setup.reasoningEffort,
    transcriptionModel: setup.transcriptionModel,
    turnType: setup.turnDetection.type,
    threshold: optionalNumber(setup.turnDetection.threshold),
    prefixPaddingMs: optionalNumber(setup.turnDetection.prefixPaddingMs),
    silenceDurationMs: optionalNumber(setup.turnDetection.silenceDurationMs),
    eagerness: setup.turnDetection.eagerness ?? "auto",
    noiseReduction: setup.noiseReduction,
    maxTurnsWithoutReply: String(setup.maxTurnsWithoutReply),
    allow: setup.allow.join("\n"),
    deny: setup.deny.join("\n"),
    userName: setup.userName ?? setup.onBehalfOf ?? "",
    callbackNumber: setup.callbackNumber ?? "",
    aboutMe: setup.aboutMe ?? "",
  };
}

export function draftChanged(draft: CallsDraft, saved: CallsDraft): boolean {
  return (Object.keys(draft) as DraftField[]).some((field) => field !== "modelChoice" && draft[field].trim() !== saved[field].trim());
}

export function keepEdits<T extends object>(next: T, saved: T, draft: T): T {
  const merged = { ...next };
  for (const key of Object.keys(next) as Array<keyof T>) if (draft[key] !== saved[key]) merged[key] = draft[key];
  return merged;
}

export function splitRules(text: string): string[] {
  return text.split(/[\n,]/).map((rule) => rule.trim()).filter(Boolean);
}

function httpsAddress(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname ? url.origin + url.pathname.replace(/\/+$/, "") : null;
  } catch { return null; }
}

type NumberField = "maxMinutes" | "maxTurnsWithoutReply" | (typeof SERVER_VAD_FIELDS)[number];

export const NUMBER_RANGES: Record<NumberField, { min: number; max: number; step: number; whole: boolean; wrong: LocaleKey }> = {
  maxMinutes: { min: 1, max: 60, step: 1, whole: true, wrong: "settings.calls.maxMinutesInvalid" },
  maxTurnsWithoutReply: { min: 1, max: 10, step: 1, whole: true, wrong: "settings.calls.maxTurnsInvalid" },
  threshold: { min: 0, max: 1, step: 0.01, whole: false, wrong: "settings.calls.thresholdInvalid" },
  prefixPaddingMs: { min: 0, max: 2000, step: 1, whole: true, wrong: "settings.calls.prefixPaddingInvalid" },
  silenceDurationMs: { min: 100, max: 5000, step: 1, whole: true, wrong: "settings.calls.silenceInvalid" },
};

function numberOf(field: NumberField, raw: string): number | null {
  const { min, max, whole } = NUMBER_RANGES[field];
  const text = raw.trim();
  const value = Number(text);
  return text && Number.isFinite(value) && value >= min && value <= max && (!whole || Number.isInteger(value)) ? value : null;
}

/** The whole turn detection for the chosen type (blank numbers are left to the server's default), or null with `invalid` filled. */
function turnDetectionOf(draft: CallsDraft, invalid: Partial<Record<DraftField, LocaleKey>>): CallTurnDetection | null {
  if (draft.turnType === "semantic_vad") return { type: "semantic_vad", eagerness: draft.eagerness };
  const detection: CallTurnDetection = { type: "server_vad" };
  for (const field of SERVER_VAD_FIELDS) {
    if (!draft[field].trim()) continue;
    const value = numberOf(field, draft[field]);
    if (value === null) invalid[field] = NUMBER_RANGES[field].wrong;
    else detection[field] = value;
  }
  return SERVER_VAD_FIELDS.some((field) => invalid[field]) ? null : detection;
}

/** The `calls` part of a config patch for what changed since `saved` (null deletes a field), or the fields that are wrong. */
export function callsPatch(draft: CallsDraft, saved: CallsDraft, legacy: Pick<CallsSetup, "onBehalfOf"> = {}):
  { ok: true; calls: Record<string, unknown> } | { ok: false; invalid: Partial<Record<DraftField, LocaleKey>> } {
  const invalid: Partial<Record<DraftField, LocaleKey>> = {};
  const calls: Record<string, unknown> = {};
  const changed = (field: DraftField) => draft[field].trim() !== saved[field].trim();
  const text = (field: "model" | "voice" | "transcriptionModel", pattern?: RegExp, wrong?: LocaleKey) => {
    if (!changed(field)) return;
    const value = draft[field].trim();
    if (pattern && wrong && !pattern.test(value)) invalid[field] = wrong;
    else calls[field] = value || null;
  };
  const whole = (field: "maxMinutes" | "maxTurnsWithoutReply") => {
    if (!changed(field)) return;
    const value = numberOf(field, draft[field]);
    if (value === null) invalid[field] = NUMBER_RANGES[field].wrong;
    else calls[field] = value;
  };

  if (changed("callerId")) {
    const raw = draft.callerId.trim();
    const number = raw ? e164(raw) : null;
    if (raw && !number) invalid.callerId = "settings.calls.callerIdInvalid";
    else calls.callerId = number;
  }
  if (changed("publicUrl")) {
    const raw = draft.publicUrl.trim();
    const address = raw ? httpsAddress(raw) : null;
    if (raw && !address) invalid.publicUrl = "settings.calls.publicUrlInvalid";
    else calls.publicUrl = address;
  }
  whole("maxMinutes");
  text("model", /^[\w.-]*$/, "settings.calls.modelInvalid");
  text("voice", /^[a-z]*$/, "settings.calls.voiceInvalid");
  text("transcriptionModel", /^[\w.-]*$/, "settings.calls.modelInvalid");
  if (changed("reasoningEffort")) calls.reasoningEffort = draft.reasoningEffort === DEFAULT_REASONING_EFFORT ? null : draft.reasoningEffort;
  if (changed("turnType") || TURN_FIELDS[draft.turnType].some(changed)) {
    const detection = turnDetectionOf(draft, invalid);
    if (detection) calls.turnDetection = detection;
  }
  if (changed("noiseReduction")) calls.noiseReduction = draft.noiseReduction;
  whole("maxTurnsWithoutReply");
  for (const field of Object.keys(ABOUT_YOU_LIMITS) as AboutYouField[]) {
    if (!changed(field)) continue;
    const value = draft[field].trim();
    if (value.length > ABOUT_YOU_LIMITS[field].max) invalid[field] = ABOUT_YOU_LIMITS[field].wrong;
    else calls[field] = value || null;
  }
  if (changed("userName") && legacy.onBehalfOf !== undefined) calls.onBehalfOf = null;
  for (const field of ["allow", "deny"] as const) {
    if (!changed(field)) continue;
    const rules = splitRules(draft[field]).map((rule) => numberRule(rule));
    if (rules.some((rule) => rule === null)) invalid[field] = "settings.calls.ruleInvalid";
    else calls[field] = rules.length ? rules : null;
  }
  return Object.keys(invalid).length ? { ok: false, invalid } : { ok: true, calls };
}

export const PROMPT_MAX = 12_000;

export type PromptDraft = Record<CallPromptKey, string>;

export const PROMPT_LABEL: Record<CallPromptKey, LocaleKey> = {
  disclosure: "settings.calls.prompt.disclosure",
  instructions: "settings.calls.prompt.instructions",
  opening: "settings.calls.prompt.opening",
  openingOwner: "settings.calls.prompt.openingOwner",
  closing: "settings.calls.prompt.closing",
  wrapUp: "settings.calls.prompt.wrapUp",
  goodbye: "settings.calls.prompt.goodbye",
  defaultBrief: "settings.calls.prompt.defaultBrief",
  endCallDescription: "settings.calls.prompt.endCallDescription",
};

export const PROMPT_ROLE: Record<CallPromptKey, LocaleKey> = {
  disclosure: "settings.calls.promptRole.disclosure",
  instructions: "settings.calls.promptRole.instructions",
  opening: "settings.calls.promptRole.opening",
  openingOwner: "settings.calls.promptRole.openingOwner",
  closing: "settings.calls.promptRole.closing",
  wrapUp: "settings.calls.promptRole.wrapUp",
  goodbye: "settings.calls.promptRole.goodbye",
  defaultBrief: "settings.calls.promptRole.defaultBrief",
  endCallDescription: "settings.calls.promptRole.endCallDescription",
};

export const PLACEHOLDER_MEANING: Partial<Record<string, LocaleKey>> = {
  forUser: "settings.calls.placeholder.forUser",
  userName: "settings.calls.placeholder.userName",
  purpose: "settings.calls.placeholder.purpose",
  bookingName: "settings.calls.placeholder.bookingName",
  callbackNumber: "settings.calls.placeholder.callbackNumber",
  details: "settings.calls.placeholder.details",
  callType: "settings.calls.placeholder.callType",
  callTypeNote: "settings.calls.placeholder.callTypeNote",
  onBehalfOf: "settings.calls.placeholder.onBehalfOf",
  callee: "settings.calls.placeholder.callee",
  calleeName: "settings.calls.placeholder.calleeName",
  to: "settings.calls.placeholder.to",
  botName: "settings.calls.placeholder.botName",
  brief: "settings.calls.placeholder.brief",
  disclosure: "settings.calls.placeholder.disclosure",
  maxMinutes: "settings.calls.placeholder.maxMinutes",
  disclosureHeard: "settings.calls.placeholder.disclosureHeard",
  recordingNotice: "settings.calls.placeholder.recordingNotice",
};

export function promptDraftFrom(setup: Pick<CallsSetup, "prompts">): PromptDraft {
  return Object.fromEntries(CALL_PROMPT_KEYS.map((key) => [key, setup.prompts[key].value])) as PromptDraft;
}

/** The changed texts as they are (an emptied one is null: back to its default), or the ones that are too long. */
export function promptsPatch(draft: PromptDraft, saved: PromptDraft):
  { ok: true; calls: Partial<Record<CallPromptKey, string | null>> } | { ok: false; invalid: Partial<Record<CallPromptKey, LocaleKey>> } {
  const invalid: Partial<Record<CallPromptKey, LocaleKey>> = {};
  const calls: Partial<Record<CallPromptKey, string | null>> = {};
  for (const key of CALL_PROMPT_KEYS) {
    if (draft[key] === saved[key]) continue;
    if (draft[key].length > PROMPT_MAX) invalid[key] = "settings.calls.promptTooLong";
    else calls[key] = draft[key].trim() ? draft[key] : null;
  }
  return Object.keys(invalid).length ? { ok: false, invalid } : { ok: true, calls };
}

export const CALL_TYPE_LABEL: Record<CallCaller["callType"], LocaleKey> = {
  business: "settings.calls.caller.business",
  owner: "settings.calls.caller.owner",
};

const SOURCE_LABEL: Record<Exclude<CallInfoSource, "none">, LocaleKey> = {
  call: "settings.calls.from.call",
  settings: "settings.calls.from.settings",
  profile: "settings.calls.from.profile",
};

export function callerRows(caller: CallCaller, t: (key: LocaleKey) => string): Array<{ id: string; label: string; value: string }> {
  const none = t("settings.calls.caller.none");
  const sourced = (value: string | undefined, from: CallInfoSource) =>
    from === "none" || !value?.trim() ? none : `${value} · ${t(SOURCE_LABEL[from])}`;
  const details = caller.details?.trim() ? caller.details : none;
  return [
    { id: "callType", label: t("settings.calls.caller.callType"), value: t(CALL_TYPE_LABEL[caller.callType]) },
    { id: "purpose", label: t("settings.calls.caller.purpose"), value: caller.purpose?.trim() ? caller.purpose : none },
    { id: "userName", label: t("settings.calls.caller.userName"), value: sourced(caller.userName, caller.userNameFrom) },
    { id: "bookingName", label: t("settings.calls.caller.bookingName"), value: sourced(caller.bookingName, caller.bookingNameFrom) },
    { id: "callbackNumber", label: t("settings.calls.callbackNumber"), value: sourced(caller.callbackNumber, caller.callbackNumberFrom) },
    { id: "details", label: t("settings.calls.caller.details"), value: caller.aboutMeIncluded ? `${details} · ${t("settings.calls.caller.aboutMeIncluded")}` : details },
  ];
}

/** Whether Twilio spoke the disclosure on this call; undefined for a call placed before it was recorded. */
export function disclosureSpoken(sent: Pick<CallSent, "disclosureEnabled" | "disclosureSpoken">): boolean | undefined {
  return sent.disclosureSpoken ?? sent.disclosureEnabled;
}

export function callOngoing(call: Pick<CallSummary, "phase">): boolean {
  return call.phase !== "ended";
}

export function recordingDownloadUrl(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

export function clockLength(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** When a transcript line was said, from the start of the call. */
export function lineOffset(call: Pick<CallDetail, "answeredAt" | "createdAt">, at: number): string {
  return clockLength((at - (call.answeredAt ?? call.createdAt)) / 1000);
}
