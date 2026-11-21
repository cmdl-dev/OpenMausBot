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
export const CALL_PROMPT_KEYS = ["disclosure", "instructions", "opening", "openingOwner", "closing", "wrapUp", "goodbye", "defaultBrief", "endCallDescription"] as const;
export type CallPromptKey = (typeof CALL_PROMPT_KEYS)[number];

/** What each editable text is, for the Settings screen. */
export const CALL_PROMPT_ROLES: Record<CallPromptKey, string> = {
  disclosure: "Spoken by Twilio's voice the moment the callee answers, before the AI voice says anything.",
  instructions: "The AI voice's instructions (OpenAI Realtime session instructions), sent whole at the start of the call.",
  opening: "Sent once as the first response's instructions on a business call (the bot calls a shop, an office, anyone but you): what the voice says first.",
  openingOwner: "The same, when the bot calls you yourself.",
  closing: "Sent when the voice tries to hang up without having said goodbye; the call hangs up after it.",
  wrapUp: "Sent as a system message shortly before the time limit.",
  goodbye: "Sent when the callee hasn't said anything for several voice turns in a row; the call hangs up after it.",
  defaultBrief: "Used as {brief} when a bot placed a call without one.",
  endCallDescription: "The description of the end_call tool the voice uses to hang up.",
};

/** The `{name}` placeholders every call text may use. */
export const CALL_PLACEHOLDERS: ReadonlyArray<{ name: string; meaning: string }> = [
  { name: "forUser", meaning: "\"for <your name>\", or \"for a client\" when no name is known." },
  { name: "userName", meaning: "The name the voice gives: the bot's on_behalf_of, else Your name in About you, else your profile name; empty when none is known." },
  { name: "purpose", meaning: "Why the bot is calling, in a few words (\"book a haircut this Sunday\"); \"help with a quick request\" when the bot gave none." },
  { name: "bookingName", meaning: "The name for any booking: the bot's booking_name, else {userName}; empty when none is known." },
  { name: "callbackNumber", meaning: "A number the voice may give: the bot's callback_number, else Callback number in About you; empty when none." },
  { name: "details", meaning: "What the voice may share: the bot's details, then About me from About you, labelled; empty when none." },
  { name: "callType", meaning: "\"business\" or \"owner\" (the bot is calling you yourself)." },
  { name: "callTypeNote", meaning: "Business: \"You are calling a business or someone other than the person you represent.\" Owner: \"You are calling the person you represent themselves, not a business.\"" },
  { name: "onBehalfOf", meaning: "Kept for texts saved earlier: {userName}, or \"a client\" when no name is known." },
  { name: "callee", meaning: "The callee's name, or \"the person you called\" when the bot gave none." },
  { name: "calleeName", meaning: "The callee's name as the bot gave it, empty when there is none." },
  { name: "to", meaning: "The number called, E.164." },
  { name: "botName", meaning: "The bot that placed the call." },
  { name: "brief", meaning: "The bot's brief for this call." },
  { name: "disclosure", meaning: "The disclosure line, as spoken." },
  { name: "maxMinutes", meaning: "The call's time limit in minutes." },
  { name: "disclosureHeard", meaning: "While Speak disclosure is on: When they answered, they heard: \"<the disclosure>\" Don't repeat it. While it is off: Nothing was said to them before you spoke; they haven't been told this call is from an AI assistant." },
  { name: "recordingNotice", meaning: "\"This call is recorded.\" while recording is on, else \"This call is transcribed.\"" },
];

/** The Realtime models offered in Settings, with OpenAI's audio prices in dollars per 1M tokens. Another model id can
 * still be typed. */
export const REALTIME_MODELS: ReadonlyArray<{ id: string; label: string; audioIn: number; audioOut: number }> = [
  { id: "gpt-realtime-2.1-mini", label: "GPT-Realtime-2.1 mini", audioIn: 10, audioOut: 20 },
  { id: "gpt-realtime-2.1", label: "GPT-Realtime-2.1", audioIn: 32, audioOut: 64 },
];

/** OpenAI's audio tokens per minute: what the callee says (input) and what the voice says (output). */
export const AUDIO_TOKENS_PER_MINUTE = { in: 600, out: 1_200 } as const;

/** About what one minute of the callee's audio and one minute of the voice's audio cost on `model`, in dollars. */
export function realtimeMinuteCost(model: { audioIn: number; audioOut: number }): { listening: number; speaking: number } {
  return { listening: (model.audioIn * AUDIO_TOKENS_PER_MINUTE.in) / 1_000_000, speaking: (model.audioOut * AUDIO_TOKENS_PER_MINUTE.out) / 1_000_000 };
}

/** OpenAI Realtime's built-in voices; OpenAI recommends marin and cedar for the best quality. */
export const REALTIME_VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"] as const;
export const RECOMMENDED_VOICES: ReadonlySet<string> = new Set(["marin", "cedar"]);

/** Where a name or number a call used came from: the bot's place_call, About you in Settings, your profile, or
 * nowhere. */
export type CallInfoSource = "call" | "settings" | "profile" | "none";

/** Who a call is for and why, as resolved when it was placed. Empty fields render as their placeholder says. */
export interface CallCaller {
  callType: "business" | "owner";
  purpose?: string;
  userName?: string;
  userNameFrom: CallInfoSource;
  bookingName?: string;
  bookingNameFrom: CallInfoSource;
  callbackNumber?: string;
  callbackNumberFrom: CallInfoSource;
  details?: string;
  /** About me from Settings was added to `details`. */
  aboutMeIncluded: boolean;
}

/** How much the voice reasons before it speaks (`reasoning.effort`); more is slower. */
export const CALL_REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;
export type CallReasoningEffort = (typeof CALL_REASONING_EFFORTS)[number];

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
  /** Absent on calls placed before it was a setting, and for a model that doesn't reason. */
  reasoningEffort?: CallReasoningEffort;
  closing?: string;
  maxTurnsWithoutReply: number;
  maxMinutes: number;
  /** The call was recorded on this computer. */
  recorded: boolean;
  /** Speak disclosure was on for this call. */
  disclosureEnabled?: boolean;
  /** Twilio spoke `disclosure` when the callee answered: false until then, and for a call nobody answered. */
  disclosureSpoken?: boolean;
  /** The session.update that starts the voice, exactly as sent: replies and interruptions wait until the opening has
   * been said. */
  session: Record<string, unknown>;
  /** The session.update sent once the opening was said, turning automatic replies and interruptions on. */
  afterOpening?: Record<string, unknown>;
  /** Who the call was for and why; absent on calls placed before it was asked. */
  caller?: CallCaller;
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
  /** About you: the name the voice gives (`calls.userName`). */
  userName?: string;
  /** A name saved by an earlier version as Calls on behalf of (`calls.onBehalfOf`); used as Your name while that is empty. */
  onBehalfOf?: string;
  /** About you: a number the voice may give (`calls.callbackNumber`). */
  callbackNumber?: string;
  /** About you: what the voice may share about you (`calls.aboutMe`). */
  aboutMe?: string;
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
  /** Twilio speaks the disclosure when the callee answers (`calls.disclosureEnabled`, on unless false). */
  disclosureEnabled: boolean;
  reasoningEffort: CallReasoningEffort;
  /** The name a call uses when the bot gives none, and where it comes from; empty with `from: "none"`, when the voice
   * says it is calling for a client. */
  nameDefault: { name: string; from: CallInfoSource };
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
