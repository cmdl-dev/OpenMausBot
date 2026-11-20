import type { LocaleKey } from "@/locales";
import {
  CALL_PROMPT_KEYS, e164, numberRule, type CallDetail, type CallEndReason, type CallNoiseReduction, type CallPromptKey, type CallSetting, type CallsSetup,
  type CallSummary, type CallTurnDetection,
} from "../../../shared/phone-calls";

export type { CallDetail, CallLine, CallPromptKey, CallSent, CallSummary, CallTurnDetection } from "../../../shared/phone-calls";
export { CALL_PLACEHOLDERS, CALL_PROMPT_KEYS } from "../../../shared/phone-calls";

/** `GET /api/calls/setup`, with the name the voice says it calls for. */
export type CallsSetupStatus = CallsSetup & { onBehalfOf?: string };

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

export const TURN_TYPES: readonly TurnType[] = ["server_vad", "semantic_vad"];
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

export interface CallsDraft {
  callerId: string;
  publicUrl: string;
  maxMinutes: string;
  model: string;
  voice: string;
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
  onBehalfOf: string;
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
    model: setup.model,
    voice: setup.voice,
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
    onBehalfOf: setup.onBehalfOf ?? "",
  };
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
export function callsPatch(draft: CallsDraft, saved: CallsDraft):
  { ok: true; calls: Record<string, unknown> } | { ok: false; invalid: Partial<Record<DraftField, LocaleKey>> } {
  const invalid: Partial<Record<DraftField, LocaleKey>> = {};
  const calls: Record<string, unknown> = {};
  const changed = (field: DraftField) => draft[field].trim() !== saved[field].trim();
  const text = (field: "model" | "voice" | "transcriptionModel" | "onBehalfOf", pattern?: RegExp, wrong?: LocaleKey) => {
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
  if (changed("turnType") || TURN_FIELDS[draft.turnType].some(changed)) {
    const detection = turnDetectionOf(draft, invalid);
    if (detection) calls.turnDetection = detection;
  }
  if (changed("noiseReduction")) calls.noiseReduction = draft.noiseReduction;
  whole("maxTurnsWithoutReply");
  text("onBehalfOf");
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
  wrapUp: "settings.calls.prompt.wrapUp",
  goodbye: "settings.calls.prompt.goodbye",
  defaultBrief: "settings.calls.prompt.defaultBrief",
  endCallDescription: "settings.calls.prompt.endCallDescription",
};

export const PROMPT_ROLE: Record<CallPromptKey, LocaleKey> = {
  disclosure: "settings.calls.promptRole.disclosure",
  instructions: "settings.calls.promptRole.instructions",
  opening: "settings.calls.promptRole.opening",
  wrapUp: "settings.calls.promptRole.wrapUp",
  goodbye: "settings.calls.promptRole.goodbye",
  defaultBrief: "settings.calls.promptRole.defaultBrief",
  endCallDescription: "settings.calls.promptRole.endCallDescription",
};

export const PLACEHOLDER_MEANING: Partial<Record<string, LocaleKey>> = {
  onBehalfOf: "settings.calls.placeholder.onBehalfOf",
  callee: "settings.calls.placeholder.callee",
  calleeName: "settings.calls.placeholder.calleeName",
  to: "settings.calls.placeholder.to",
  botName: "settings.calls.placeholder.botName",
  brief: "settings.calls.placeholder.brief",
  disclosure: "settings.calls.placeholder.disclosure",
  maxMinutes: "settings.calls.placeholder.maxMinutes",
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

export function callOngoing(call: Pick<CallSummary, "phase">): boolean {
  return call.phase !== "ended";
}

export function clockLength(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** When a transcript line was said, from the start of the call. */
export function lineOffset(call: Pick<CallDetail, "answeredAt" | "createdAt">, at: number): string {
  return clockLength((at - (call.answeredAt ?? call.createdAt)) / 1000);
}
