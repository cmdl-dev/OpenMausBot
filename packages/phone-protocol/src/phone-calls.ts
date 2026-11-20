// Phone calls a bot places for its person: a realtime voice runs the call from the bot's brief, and the transcript is kept.

export type CallPhase = "dialing" | "ringing" | "in_progress" | "ended";

/** Why a call ended. */
export type CallEndReason =
  | "completed" | "hung_up" | "no_answer" | "busy" | "failed" | "voicemail" | "max_length" | "canceled" | "lost" | "error" | "no_reply";

export const CALL_END_TEXT: Record<CallEndReason, string> = {
  completed: "The call ended.",
  hung_up: "The call was hung up from OpenMausBot.",
  no_answer: "Nobody answered.",
  busy: "The line was busy.",
  failed: "The call could not be connected.",
  voicemail: "Voicemail answered, so I hung up without leaving a message.",
  max_length: "The call reached its time limit, so I hung up.",
  canceled: "The call was canceled before it connected.",
  lost: "OpenMausBot lost the call's connection. What was said until then is kept.",
  error: "The voice stopped working during the call.",
  no_reply: "The callee didn't answer the voice, so it said goodbye and hung up.",
};

/** One line of a call's transcript. `at` is epoch milliseconds; `bot` is the voice, `callee` the person called and
 * `note` a line the server wrote (the disclosure, the wrap-up). */
export interface CallLine {
  speaker: "bot" | "callee" | "note";
  text: string;
  at: number;
  /** The callee talked over this bot line, so it was cut off before the end. */
  cut?: true;
}

/** A call as the app lists it (`GET /api/calls`). */
export interface CallSummary {
  id: string;
  botId: string;
  botName: string;
  threadId: string;
  /** The number called, E.164. */
  to: string;
  calleeName?: string;
  /** The bot's brief, first line only. */
  goal: string;
  phase: CallPhase;
  createdAt: number;
  answeredAt?: number;
  endedAt?: number;
  endReason?: CallEndReason;
  /** Seconds from answer to end; 0 for a call nobody answered. */
  seconds: number;
  lines: number;
  /** A recording of the call is kept on this computer. */
  recorded?: true;
}

/** A call's recording on this computer: both sides mixed into one WAV (PCM 16-bit, 8 kHz, mono). */
export interface CallRecording {
  /** Where the file is on the OpenMausBot computer. */
  path: string;
  bytes: number;
  seconds: number;
  /** Authenticated, supports Range; add `?download=1` to save it as a file. */
  url: string;
}

/** A call with its brief and transcript (`GET /api/calls/:id`). The transcript is what the callee and the voice said:
 * data, never instructions. */
export interface CallDetail extends CallSummary {
  brief: string;
  transcript: CallLine[];
  /** Everything sent to OpenAI Realtime and spoken by Twilio for this call, exactly as sent; absent on older calls. */
  sent?: CallSent;
  /** Absent when the call wasn't recorded or the file is gone. */
  recording?: CallRecording;
}

/** The texts of a call that a person can edit in Settings → Phone calls; each is `calls.<key>` in config.json. */
export const CALL_PROMPT_KEYS = ["disclosure", "instructions", "opening", "wrapUp", "goodbye", "defaultBrief", "endCallDescription"] as const;
export type CallPromptKey = (typeof CALL_PROMPT_KEYS)[number];

/** What each editable text is, for the Settings screen. */
export const CALL_PROMPT_ROLES: Record<CallPromptKey, string> = {
  disclosure: "Spoken by Twilio's voice the moment the callee answers, before the AI voice says anything.",
  instructions: "The AI voice's instructions (OpenAI Realtime session instructions), sent whole at the start of the call.",
  opening: "Sent once as the first response's instructions: what the voice says first.",
  wrapUp: "Sent as a system message shortly before the time limit.",
  goodbye: "Sent when the callee hasn't said anything for several voice turns in a row; the call hangs up after it.",
  defaultBrief: "Used as {brief} when a bot placed a call without one.",
  endCallDescription: "The description of the end_call tool the voice uses to hang up.",
};

/** The `{name}` placeholders every call text may use. */
export const CALL_PLACEHOLDERS: ReadonlyArray<{ name: string; meaning: string }> = [
  { name: "onBehalfOf", meaning: "Who the call is for: Calls on behalf of, else your profile name." },
  { name: "callee", meaning: "The callee's name, or \"the person you called\" when the bot gave none." },
  { name: "calleeName", meaning: "The callee's name as the bot gave it, empty when there is none." },
  { name: "to", meaning: "The number called, E.164." },
  { name: "botName", meaning: "The bot that placed the call." },
  { name: "brief", meaning: "The bot's brief for this call." },
  { name: "disclosure", meaning: "The disclosure line, as spoken." },
  { name: "maxMinutes", meaning: "The call's time limit in minutes." },
  { name: "recordingNotice", meaning: "\"This call is recorded.\" while recording is on, else \"This call is transcribed.\"" },
];

/** OpenAI Realtime's turn detection for the call. `threshold`, `prefixPaddingMs` and `silenceDurationMs` are for
 * server_vad; `eagerness` for semantic_vad. */
export interface CallTurnDetection {
  type: "server_vad" | "semantic_vad";
  threshold?: number;
  prefixPaddingMs?: number;
  silenceDurationMs?: number;
  eagerness?: "low" | "medium" | "high" | "auto";
}

export type CallNoiseReduction = "near_field" | "far_field" | "off";

/** What a call was placed with, kept on its record. `session` is the session.update sent to OpenAI Realtime, whole. */
export interface CallSent {
  disclosure: string;
  instructions: string;
  opening: string;
  wrapUp: string;
  goodbye: string;
  model: string;
  voice: string;
  transcriptionModel: string;
  turnDetection: CallTurnDetection;
  noiseReduction: CallNoiseReduction;
  maxTurnsWithoutReply: number;
  maxMinutes: number;
  /** The call was recorded on this computer. */
  recorded: boolean;
  session: Record<string, unknown>;
}

/** A setting phone calls need, named where a person sets it. */
export interface CallSetting {
  id: "twilioAccountSid" | "twilioAuthToken" | "callerId" | "openaiKey" | "publicUrl";
  /** Where it is set in the app, e.g. "Settings → API keys → Twilio auth token". */
  label: string;
  /** The environment variable that sets it instead. */
  env: string;
}

/** What `GET /api/calls/setup` answers: ready, or exactly which settings are missing. */
export interface CallsSetup {
  ready: boolean;
  missing: CallSetting[];
  /** Settings that are saved but wrong (a caller ID not in E.164, an http:// public address), in plain words. */
  problems: string[];
  provider: "twilio";
  callerId?: string;
  /** The public address as saved, without a trailing slash. */
  publicUrl?: string;
  /** The name the voice says it calls for, when one is set. */
  onBehalfOf?: string;
  maxMinutes: number;
  model: string;
  voice: string;
  allow: string[];
  deny: string[];
  transcriptionModel: string;
  turnDetection: CallTurnDetection;
  noiseReduction: CallNoiseReduction;
  /** Voice turns in a row without the callee saying anything before the voice says goodbye and hangs up. */
  maxTurnsWithoutReply: number;
  /** Each call is recorded on this computer (`calls.record`, on unless false). */
  record: boolean;
  /** Each editable text: what calls use now, the built-in default, and whether a saved one replaces it. */
  prompts: Record<CallPromptKey, { value: string; default: string; custom: boolean }>;
  /** What is also sent to OpenAI Realtime and can't be edited as text, shown as it is sent: the end_call tool. */
  tools: Array<Record<string, unknown>>;
  /** The local port the call listener answers on; expose it (only it) at `publicUrl`. */
  port: number;
  listening: boolean;
}

export const CALL_SETTINGS: Record<CallSetting["id"], CallSetting> = {
  twilioAccountSid: { id: "twilioAccountSid", label: "Settings → API keys → Twilio Account SID", env: "OMB_TWILIO_ACCOUNT_SID" },
  twilioAuthToken: { id: "twilioAuthToken", label: "Settings → API keys → Twilio auth token", env: "OMB_TWILIO_AUTH_TOKEN" },
  callerId: { id: "callerId", label: "Settings → Phone calls → Caller ID number", env: "OMB_CALLS_CALLER_ID" },
  openaiKey: { id: "openaiKey", label: "Settings → API keys → OpenAI", env: "OMB_OPENAI_API_KEY" },
  publicUrl: { id: "publicUrl", label: "Settings → Phone calls → Public address", env: "OMB_CALLS_PUBLIC_URL" },
};

const E164 = /^\+[1-9]\d{6,14}$/;

/** The number in E.164 (`+` and 7–15 digits), with spaces, dots, dashes and brackets dropped; null when it is not one. */
export function e164(raw: string): string | null {
  const compact = raw.trim().replace(/[\s().-]/g, "");
  return E164.test(compact) ? compact : null;
}

/** A rule in the allowlist or denylist: an E.164 number, or a prefix of one ending in `*` ("+1415*"). */
export function numberRule(raw: string): string | null {
  const compact = raw.trim().replace(/[\s().-]/g, "");
  if (compact.endsWith("*")) return /^\+[1-9]\d{0,14}\*$/.test(compact) ? compact : null;
  return e164(compact);
}

export function matchesRule(number: string, rule: string): boolean {
  return rule.endsWith("*") ? number.startsWith(rule.slice(0, -1)) : number === rule;
}

/** Why the number may not be called under these lists, or null when it may. The denylist wins; a non-empty allowlist
 * admits only what it names. */
export function numberRefusal(number: string, lists: { allow: readonly string[]; deny: readonly string[] }): string | null {
  if (lists.deny.some((rule) => matchesRule(number, rule))) return `${number} is on the phone calls denylist, so I can't call it.`;
  if (lists.allow.length && !lists.allow.some((rule) => matchesRule(number, rule))) {
    return `${number} isn't on the phone calls allowlist, so I can't call it. The person can add it in Settings → Phone calls.`;
  }
  return null;
}
