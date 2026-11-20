import type { LocaleKey } from "@/locales";
import { e164, numberRule, type CallDetail, type CallEndReason, type CallSetting, type CallsSetup, type CallSummary } from "../../../shared/phone-calls";

export type { CallDetail, CallLine, CallSummary } from "../../../shared/phone-calls";

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
};

export const SETTING_LABEL: Record<CallSetting["id"], LocaleKey> = {
  twilioAccountSid: "keys.label.twilioSid",
  twilioAuthToken: "keys.label.twilioToken",
  openaiKey: "keys.openai.label",
  callerId: "settings.calls.callerId",
  publicUrl: "settings.calls.publicUrl",
};

export interface CallsDraft {
  callerId: string;
  publicUrl: string;
  maxMinutes: string;
  model: string;
  voice: string;
  allow: string;
  deny: string;
  onBehalfOf: string;
}

export type DraftField = keyof CallsDraft;

export function draftFrom(setup: CallsSetupStatus): CallsDraft {
  return {
    callerId: setup.callerId ?? "",
    publicUrl: setup.publicUrl ?? "",
    maxMinutes: String(setup.maxMinutes),
    model: setup.model,
    voice: setup.voice,
    allow: setup.allow.join("\n"),
    deny: setup.deny.join("\n"),
    onBehalfOf: setup.onBehalfOf ?? "",
  };
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

/** The `calls` part of a config patch for what changed since `saved` (null deletes a field), or the fields that are wrong. */
export function callsPatch(draft: CallsDraft, saved: CallsDraft):
  { ok: true; calls: Record<string, unknown> } | { ok: false; invalid: Partial<Record<DraftField, LocaleKey>> } {
  const invalid: Partial<Record<DraftField, LocaleKey>> = {};
  const calls: Record<string, unknown> = {};
  const changed = (field: DraftField) => draft[field].trim() !== saved[field].trim();
  const text = (field: "model" | "voice" | "onBehalfOf") => { if (changed(field)) calls[field] = draft[field].trim() || null; };

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
  if (changed("maxMinutes")) {
    const minutes = Number(draft.maxMinutes.trim());
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) invalid.maxMinutes = "settings.calls.maxMinutesInvalid";
    else calls.maxMinutes = minutes;
  }
  text("model");
  text("voice");
  text("onBehalfOf");
  for (const field of ["allow", "deny"] as const) {
    if (!changed(field)) continue;
    const rules = splitRules(draft[field]).map((rule) => numberRule(rule));
    if (rules.some((rule) => rule === null)) invalid[field] = "settings.calls.ruleInvalid";
    else calls[field] = rules.length ? rules : null;
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
