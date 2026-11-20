// Twilio Programmable Voice: placing and ending calls over its REST API, the TwiML that connects an answered call to
// our Media Streams socket, and checking that a webhook really came from Twilio.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { CallEndReason } from "../../shared/phone-calls.ts";
import { CallProviderError, type CallProvider, type PlaceCall, type ProviderProgress } from "./provider.ts";

const TWILIO_API = "https://api.twilio.com";
const REQUEST_MS = 15_000;

/** Only a loopback http URL is accepted, so a test or fixture can stand in for Twilio; never a remote host. */
export function twilioApiBase(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OMB_TWILIO_API_URL?.trim() ?? "";
  return /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(override) ? override : TWILIO_API;
}

/** Twilio's documented error codes a person can act on, in plain words. */
const KNOWN_ERRORS: Record<number, string> = {
  20003: "Twilio refused the Account SID or auth token. Check them in Settings → API keys.",
  21210: "Twilio says the caller ID number isn't verified on this account. Verify it in the Twilio console (Phone Numbers → Verified Caller IDs) or use a number the account owns.",
  21212: "Twilio says the caller ID number isn't valid for this account.",
  21211: "Twilio says the number to call isn't valid.",
  21214: "Twilio says the number to call can't be reached.",
  21215: "Twilio's geographic permissions don't allow calling this country. Turn it on in the Twilio console (Voice → Settings → Geo permissions).",
  21219: "A Twilio trial account can only call verified numbers. Verify this number in the Twilio console, or upgrade the account.",
};

const statusReason: Record<string, CallEndReason> = {
  completed: "completed", busy: "busy", "no-answer": "no_answer", failed: "failed", canceled: "canceled",
};

/** A Twilio CallStatus in our words. */
export function twilioProgress(status: string | undefined, duration?: string): ProviderProgress {
  switch (status) {
    case "ringing": return { kind: "ringing" };
    case "in-progress": return { kind: "answered" };
    default: {
      const reason = status ? statusReason[status] : undefined;
      if (!reason) return { kind: "other" };
      const seconds = Number(duration);
      return { kind: "ended", reason, ...(Number.isFinite(seconds) && seconds >= 0 ? { seconds } : {}) };
    }
  }
}

/** Twilio's AnsweredBy: a machine or fax answered. */
export function answeredByMachine(answeredBy: string | undefined): boolean {
  return Boolean(answeredBy && (answeredBy.startsWith("machine") || answeredBy === "fax"));
}

export function createTwilioProvider(account: { accountSid: string; authToken: string }, env: NodeJS.ProcessEnv = process.env): CallProvider {
  const base = `${twilioApiBase(env)}/2010-04-01/Accounts/${encodeURIComponent(account.accountSid)}`;
  const auth = `Basic ${Buffer.from(`${account.accountSid}:${account.authToken}`).toString("base64")}`;

  async function request(path: string, init: { method: "GET" | "POST"; form?: URLSearchParams }): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method: init.method,
        headers: { authorization: auth, accept: "application/json", ...(init.form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
        ...(init.form ? { body: init.form.toString() } : {}),
        signal: AbortSignal.timeout(REQUEST_MS),
      });
    } catch (error) {
      throw new CallProviderError(`Twilio didn't answer: ${error instanceof Error ? error.message : String(error)}`);
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch { /* an empty or non-JSON answer */ }
    if (!response.ok) {
      const code = typeof body.code === "number" ? body.code : undefined;
      const said = typeof body.message === "string" ? body.message.slice(0, 300) : `HTTP ${response.status}`;
      throw new CallProviderError((code && KNOWN_ERRORS[code]) || `Twilio refused the request: ${said}${code ? ` (error ${code})` : ""}.`, response.status);
    }
    return body;
  }

  return {
    name: "twilio",
    async place(call: PlaceCall) {
      const form = new URLSearchParams({
        To: call.to, From: call.from, Url: call.answerUrl, Method: "POST",
        StatusCallback: call.statusUrl, StatusCallbackMethod: "POST",
        Timeout: String(call.ringSeconds), TimeLimit: String(call.timeLimitSeconds),
        MachineDetection: "Enable", AsyncAmd: "true", AsyncAmdStatusCallback: call.machineUrl, AsyncAmdStatusCallbackMethod: "POST",
      });
      for (const event of ["initiated", "ringing", "answered", "completed"]) form.append("StatusCallbackEvent", event);
      const body = await request("/Calls.json", { method: "POST", form });
      if (typeof body.sid !== "string" || !body.sid) throw new CallProviderError("Twilio accepted the call but gave no call id.");
      return { providerCallId: body.sid };
    },
    async hangUp(providerCallId) {
      await request(`/Calls/${encodeURIComponent(providerCallId)}.json`, { method: "POST", form: new URLSearchParams({ Status: "completed" }) });
    },
    async progress(providerCallId) {
      const body = await request(`/Calls/${encodeURIComponent(providerCallId)}.json`, { method: "GET" });
      return twilioProgress(typeof body.status === "string" ? body.status : undefined, typeof body.duration === "string" ? body.duration : undefined);
    },
  };
}

/** Twilio's request signature: HMAC-SHA1 with the auth token over the full URL followed by every POST parameter's name
 * and value, sorted by name. */
export function twilioSignature(authToken: string, url: string, params: Readonly<Record<string, string | readonly string[]>>): string {
  const data = Object.keys(params).sort().reduce((text, key) => {
    const value = params[key]!;
    const values = typeof value === "string" ? [value] : [...value].sort();
    return text + values.map((item) => `${key}${item}`).join("");
  }, url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

/** The URL as Twilio may have signed it: Twilio signs https URLs both with and without the default port. */
function signedUrlForms(url: string): string[] {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return [url];
    const withoutPort = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}${parsed.search}`;
    const withPort = `${parsed.protocol}//${parsed.hostname}:${parsed.port || "443"}${parsed.pathname}${parsed.search}`;
    return [...new Set([url, withoutPort, withPort])];
  } catch {
    return [url];
  }
}

/** Security: a webhook is acted on only when its X-Twilio-Signature matches this account's auth token. */
export function validTwilioSignature(authToken: string, url: string, params: Readonly<Record<string, string | readonly string[]>>, signature: string | undefined): boolean {
  if (!signature || !authToken) return false;
  const given = Buffer.from(signature);
  return signedUrlForms(url).some((form) => {
    const expected = Buffer.from(twilioSignature(authToken, form, params));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

/** A form body's fields, a repeated name keeping each value. */
export function formParams(body: string): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(body)) {
    const seen = params[key];
    params[key] = seen === undefined ? value : Array.isArray(seen) ? [...seen, value] : [seen, value];
  }
  return params;
}

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** The answered call: Twilio says the disclosure itself, then connects the call's audio both ways to our socket. */
export function connectStreamTwiml(input: { disclosure: string; streamUrl: string; language?: string }): string {
  const say = `<Say${input.language ? ` language="${xml(input.language)}"` : ""}>${xml(input.disclosure)}</Say>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Connect><Stream url="${xml(input.streamUrl)}"/></Connect></Response>`;
}

export function hangUpTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;
}
