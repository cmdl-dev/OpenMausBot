// Phone calls' settings in config.json, their OMB_* overrides, and what is still missing before a call can be placed.
import { z } from "zod";
import { CALL_PROMPT_KEYS, CALL_SETTINGS, e164, numberRule, type CallNoiseReduction, type CallPromptKey, type CallSetting, type CallsSetup, type CallTurnDetection } from "../../shared/phone-calls.ts";
import { usableLiveKey, type LiveConfig } from "../live-config.ts";
import { DEFAULT_CALL_PROMPTS } from "./prompt.ts";
import { endCallTool } from "./realtime.ts";

export const DEFAULT_CALL_MINUTES = 10;
export const MAX_CALL_MINUTES = 60;
export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1-mini";
export const DEFAULT_TRANSCRIPTION_MODEL = "gpt-transcribe";
export const DEFAULT_CALL_VOICE = "marin";
export const DEFAULT_CALLS_PORT = 8805;
export const DEFAULT_TURNS_WITHOUT_REPLY = 3;
export const DEFAULT_NOISE_REDUCTION: CallNoiseReduction = "near_field";
/** Phone audio is noisy and has echo: a higher threshold than OpenAI's default and a longer silence before a turn ends. */
export const DEFAULT_TURN_DETECTION: CallTurnDetection = { type: "server_vad", threshold: 0.6, prefixPaddingMs: 300, silenceDurationMs: 700 };

/** `calls` in config.json. `accountSid` and `authToken` are the Twilio account's (encrypted on the desktop like every
 * API key); `callerId` is a number verified on that account (E.164) that calls come from; `publicUrl` is the https
 * address that reaches the call listener on `port` (default 8805), e.g. a Cloudflare Tunnel or Tailscale Funnel;
 * `maxMinutes` caps each call (default 10); `model` is the OpenAI Realtime model (default gpt-realtime-2.1-mini),
 * `voice` its voice and `transcriptionModel` the model that writes down what the callee says; `allow` and `deny` are
 * E.164 numbers or prefixes ending in `*` — a non-empty allowlist admits only what it names, the denylist always wins;
 * `onBehalfOf` is the name the voice says it calls for (default: the person's profile name). The OpenAI key is
 * `openai.key`. */
export const callsConfigSchema = z.object({
  accountSid: z.string().trim().max(64).optional(),
  authToken: z.string().trim().max(128).optional(),
  callerId: z.string().trim().max(32).optional(),
  publicUrl: z.string().trim().max(300).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  maxMinutes: z.number().int().min(1).max(MAX_CALL_MINUTES).optional(),
  model: z.string().trim().max(80).regex(/^[\w.-]*$/).optional(),
  voice: z.string().trim().max(40).regex(/^[a-z]*$/).optional(),
  transcriptionModel: z.string().trim().max(80).regex(/^[\w.-]*$/).optional(),
  allow: z.array(z.string().trim().max(20)).max(200).optional(),
  deny: z.array(z.string().trim().max(20)).max(200).optional(),
  onBehalfOf: z.string().trim().max(80).optional(),
  turnDetection: z.object({
    type: z.enum(["server_vad", "semantic_vad"]),
    threshold: z.number().min(0).max(1).optional(),
    prefixPaddingMs: z.number().int().min(0).max(2_000).optional(),
    silenceDurationMs: z.number().int().min(100).max(5_000).optional(),
    eagerness: z.enum(["low", "medium", "high", "auto"]).optional(),
  }).optional(),
  noiseReduction: z.enum(["near_field", "far_field", "off"]).optional(),
  maxTurnsWithoutReply: z.number().int().min(1).max(10).optional(),
  ...Object.fromEntries(CALL_PROMPT_KEYS.map((key) => [key, z.string().max(12_000).optional()])) as Record<CallPromptKey, z.ZodOptional<z.ZodString>>,
});

export type CallsConfig = z.infer<typeof callsConfigSchema>;

/** A change to `calls`: any field may be null, which deletes it, so it falls back to its default. */
export const callsPatchSchema = z.object(Object.fromEntries(Object.entries(callsConfigSchema.shape).map(([key, field]) => [key, field.unwrap().nullable().optional()])) as {
  [K in keyof typeof callsConfigSchema.shape]: z.ZodOptional<z.ZodNullable<(typeof callsConfigSchema.shape)[K] extends z.ZodOptional<infer T> ? T : never>>
});

const list = (value: string | undefined) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);

/** config.json's `calls` with each OMB_* variable that is set taking its place. */
export function callsConfigWithEnv(calls: CallsConfig | undefined, env: NodeJS.ProcessEnv = process.env): CallsConfig {
  const next: CallsConfig = { ...calls };
  const text = (name: string, key: "accountSid" | "authToken" | "callerId" | "publicUrl" | "model" | "voice" | "onBehalfOf") => {
    if (env[name] !== undefined) next[key] = env[name]!.trim();
  };
  text("OMB_TWILIO_ACCOUNT_SID", "accountSid");
  text("OMB_TWILIO_AUTH_TOKEN", "authToken");
  text("OMB_CALLS_CALLER_ID", "callerId");
  text("OMB_CALLS_PUBLIC_URL", "publicUrl");
  text("OMB_CALLS_REALTIME_MODEL", "model");
  text("OMB_CALLS_VOICE", "voice");
  text("OMB_CALLS_ON_BEHALF_OF", "onBehalfOf");
  const minutes = Number(env.OMB_CALLS_MAX_MINUTES);
  if (Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_CALL_MINUTES) next.maxMinutes = minutes;
  const port = Number(env.OMB_CALLS_PORT);
  if (Number.isInteger(port) && port >= 0 && port <= 65_535 && env.OMB_CALLS_PORT?.trim()) next.port = port;
  if (env.OMB_CALLS_ALLOW !== undefined) next.allow = list(env.OMB_CALLS_ALLOW);
  if (env.OMB_CALLS_DENY !== undefined) next.deny = list(env.OMB_CALLS_DENY);
  return next;
}

/** The public address as an origin plus optional path without a trailing slash; null when it is not an https URL
 * without credentials, query or fragment. */
export function publicBase(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** Everything a call is placed with, once nothing is missing. */
export interface ReadyCalls {
  accountSid: string;
  authToken: string;
  callerId: string;
  publicUrl: string;
  openaiKey: string;
  maxMinutes: number;
  model: string;
  voice: string;
  transcriptionModel: string;
  turnDetection: CallTurnDetection;
  noiseReduction: CallNoiseReduction;
  maxTurnsWithoutReply: number;
  /** Each call text: the saved one, else the built-in default. */
  prompts: Record<CallPromptKey, string>;
  allow: string[];
  deny: string[];
  onBehalfOf?: string;
}

/** The saved text for each key, or the built-in default when none (or only blanks) is saved. */
export function callPrompts(calls: CallsConfig | undefined): Record<CallPromptKey, string> {
  return Object.fromEntries(CALL_PROMPT_KEYS.map((key) => [key, calls?.[key]?.trim() ? calls[key]! : DEFAULT_CALL_PROMPTS[key]])) as Record<CallPromptKey, string>;
}

/** The saved turn detection, a server_vad number left out taking the phone default. */
function turnDetectionOf(saved: CallTurnDetection | undefined): CallTurnDetection {
  if (!saved) return DEFAULT_TURN_DETECTION;
  if (saved.type === "semantic_vad") return { type: "semantic_vad", ...(saved.eagerness ? { eagerness: saved.eagerness } : {}) };
  return {
    type: "server_vad",
    threshold: saved.threshold ?? DEFAULT_TURN_DETECTION.threshold!,
    prefixPaddingMs: saved.prefixPaddingMs ?? DEFAULT_TURN_DETECTION.prefixPaddingMs!,
    silenceDurationMs: saved.silenceDurationMs ?? DEFAULT_TURN_DETECTION.silenceDurationMs!,
  };
}

/** What a call sends beyond the texts, from saved settings and defaults. */
export function callVoice(calls: CallsConfig | undefined) {
  return {
    model: calls?.model || DEFAULT_REALTIME_MODEL,
    voice: calls?.voice || DEFAULT_CALL_VOICE,
    transcriptionModel: calls?.transcriptionModel || DEFAULT_TRANSCRIPTION_MODEL,
    turnDetection: turnDetectionOf(calls?.turnDetection),
    noiseReduction: calls?.noiseReduction ?? DEFAULT_NOISE_REDUCTION,
    maxTurnsWithoutReply: calls?.maxTurnsWithoutReply ?? DEFAULT_TURNS_WITHOUT_REPLY,
    maxMinutes: calls?.maxMinutes ?? DEFAULT_CALL_MINUTES,
  };
}

export interface CallsConfigInput {
  calls?: CallsConfig;
  profile?: { name?: string };
  openai?: { key?: string };
  live?: LiveConfig;
}

/** The OpenAI key calls use: the OpenAI API key, else a Live-calls key saved for OpenAI. */
export function callsOpenAiKey(cfg: CallsConfigInput): string | undefined {
  return cfg.openai?.key?.trim() || (cfg.live?.provider === undefined || cfg.live.provider === "openai" ? usableLiveKey(cfg.live) : undefined);
}

export function callsPort(cfg: CallsConfigInput): number {
  return cfg.calls?.port ?? DEFAULT_CALLS_PORT;
}

/** The person has started setting phone calls up: any Twilio or call setting is saved. The call tools are offered then,
 * and say what is still missing. */
export function callsOffered(cfg: CallsConfigInput): boolean {
  const calls = cfg.calls ?? {};
  return Boolean(calls.accountSid || calls.authToken || calls.callerId || calls.publicUrl);
}

export function callsSettings(cfg: CallsConfigInput): { ready: ReadyCalls | null; missing: CallSetting[]; problems: string[] } {
  const calls = cfg.calls ?? {};
  const missing: CallSetting[] = [];
  const problems: string[] = [];
  const callerId = calls.callerId ? e164(calls.callerId) : null;
  const publicUrl = publicBase(calls.publicUrl);
  const openaiKey = callsOpenAiKey(cfg);
  if (!calls.accountSid) missing.push(CALL_SETTINGS.twilioAccountSid);
  else if (!/^AC[0-9a-f]{32}$/i.test(calls.accountSid)) problems.push("The Twilio Account SID should start with AC followed by 32 letters and digits.");
  if (!calls.authToken) missing.push(CALL_SETTINGS.twilioAuthToken);
  if (!calls.callerId) missing.push(CALL_SETTINGS.callerId);
  else if (!callerId) problems.push("The caller ID number must be in E.164 form, like +14155550123.");
  if (!openaiKey) missing.push(CALL_SETTINGS.openaiKey);
  if (!calls.publicUrl) missing.push(CALL_SETTINGS.publicUrl);
  else if (!publicUrl) problems.push("The public address must be an https:// URL with nothing after ? or #.");
  const rules = (values: readonly string[] | undefined, which: string) => (values ?? []).flatMap((value) => {
    const rule = numberRule(value);
    if (!rule) problems.push(`"${value}" in the ${which} isn't an E.164 number or a prefix ending in *.`);
    return rule ? [rule] : [];
  });
  const allow = rules(calls.allow, "allowlist");
  const deny = rules(calls.deny, "denylist");
  if (missing.length || problems.length) return { ready: null, missing, problems };
  return {
    ready: {
      accountSid: calls.accountSid!, authToken: calls.authToken!, callerId: callerId!, publicUrl: publicUrl!, openaiKey: openaiKey!,
      ...callVoice(calls), prompts: callPrompts(calls), allow, deny, ...(calls.onBehalfOf ? { onBehalfOf: calls.onBehalfOf } : {}),
    },
    missing,
    problems,
  };
}

/** Why no call can be placed, naming each missing setting and where it is set; null when calls are ready. */
export function callsNotReadyText(cfg: CallsConfigInput): string | null {
  const { ready, missing, problems } = callsSettings(cfg);
  if (ready) return null;
  const lines = [
    ...(missing.length ? [`Phone calls aren't set up yet. Missing: ${missing.map((setting) => `${setting.label} (or ${setting.env})`).join("; ")}.`] : []),
    ...problems,
  ];
  return lines.join(" ");
}

export function callsSetup(cfg: CallsConfigInput, listening: boolean): CallsSetup {
  const { ready, missing, problems } = callsSettings(cfg);
  const calls = cfg.calls ?? {};
  const rules = (values: readonly string[] | undefined) => (values ?? []).flatMap((value) => numberRule(value) ?? []);
  return {
    ready: ready !== null,
    missing,
    problems,
    provider: "twilio",
    ...(calls.callerId ? { callerId: calls.callerId } : {}),
    ...(calls.publicUrl ? { publicUrl: publicBase(calls.publicUrl) ?? calls.publicUrl } : {}),
    ...(calls.onBehalfOf ? { onBehalfOf: calls.onBehalfOf } : {}),
    ...callVoice(calls),
    prompts: Object.fromEntries(CALL_PROMPT_KEYS.map((key) => [key, { value: callPrompts(calls)[key], default: DEFAULT_CALL_PROMPTS[key], custom: Boolean(calls[key]?.trim()) }])) as CallsSetup["prompts"],
    tools: [endCallTool(callPrompts(calls).endCallDescription)],
    allow: rules(calls.allow),
    deny: rules(calls.deny),
    port: callsPort(cfg),
    listening,
  };
}
