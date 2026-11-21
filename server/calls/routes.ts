// The call tools' routes, called by the agents server on a bot's turn, and the app's call history routes.
import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { CALL_END_TEXT, e164, numberRefusal, type CallCaller, type CallSent, type CallsSetup } from "../../shared/phone-calls.ts";
import { resolveCaller } from "./caller.ts";
import type { json } from "../harness/http.ts";
import type { OutboundHold, OutboundHoldBot } from "../outbound-hold.ts";
import { recordsText } from "../records-block.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import type { ReadyCalls } from "./config.ts";
import { CallError, type Calls } from "./manager.ts";
import { speakerNames, transcriptText } from "./prompt.ts";

export const PLACE_CALL_TOOL = "place_call";

export interface CallRouteContext {
  method: string;
  path: string;
  res: ServerResponse;
  json: typeof json;
  readBody(): Promise<Record<string, unknown>>;
  bot: OutboundHoldBot;
  threadId: string;
  active(): boolean;
}

export interface CallRouteDeps {
  calls: () => Calls;
  settings(): ReadyCalls | { refusal: string };
  personName(threadId: string): string | undefined;
  /** The owner's profile name, when one is set. */
  ownerName(): string | undefined;
  outbound: () => Pick<OutboundHold, "hold" | "beforeDispatch">;
  /** Text written by people outside reaches this conversation. */
  markOutside(threadId: string): void;
}

const callId = z.string().min(1).max(80);
const schemas = {
  place: z.object({
    to: z.string().trim().min(3).max(40), brief: z.string().trim().min(10).max(4_000), callee_name: z.string().trim().max(80).optional(),
    purpose: z.string().trim().max(200).optional(), call_type: z.enum(["business", "owner"]).optional(),
    on_behalf_of: z.string().trim().max(80).optional(), booking_name: z.string().trim().max(80).optional(),
    details: z.string().trim().max(2_000).optional(), callback_number: z.string().trim().max(40).optional(),
  }),
  status: z.object({ call_id: callId }),
  hang_up: z.object({ call_id: callId }),
  transcript: z.object({ call_id: callId, page: z.number().int().min(1).optional() }),
};
type Action = keyof typeof schemas;
const PREFIX = "/api/internal/calls/";
const PER_PAGE = 200;

/** Every call asks the person, whatever the bot's sending rule or access level: a phone call rings a real person. */
const ALWAYS_ASK = { policy: "ask" } as const;

/** What a call sent to the voice and had Twilio say, as get_call_transcript shows it. */
const FROM: Record<CallCaller["userNameFrom"], string> = { call: "from the call", settings: "from About you", profile: "from the profile", none: "none known" };

/** Who the call was for, as get_call_transcript shows it. */
export function callerText(caller: CallCaller): string {
  return [
    `Call type: ${caller.callType}. Purpose: ${caller.purpose ?? "(none given)"}.`,
    `Name given: ${caller.userName ?? "(none, so \"for a client\")"} (${FROM[caller.userNameFrom]}). Booking name: ${caller.bookingName ?? "(none)"} (${FROM[caller.bookingNameFrom]}).`,
    `Callback number: ${caller.callbackNumber ?? "(none)"} (${FROM[caller.callbackNumberFrom]}). Details: ${caller.details ? caller.details.replace(/\s+/g, " ") : "(none)"}${caller.aboutMeIncluded ? " (includes About me)" : ""}.`,
  ].join("\n");
}

export function sentText(sent: CallSent): string {
  return [
    ...(sent.caller ? [callerText(sent.caller)] : []),
    `Sent for this call (model ${sent.model}, voice ${sent.voice}, transcription ${sent.transcriptionModel}, turn detection ${JSON.stringify(sent.turnDetection)}, noise reduction ${sent.noiseReduction}, up to ${sent.maxMinutes} min, goodbye after ${sent.maxTurnsWithoutReply} turns without a reply):`,
    sent.disclosureEnabled === false
      ? `Disclosure: off, so nothing was said before the voice spoke (saved text, not spoken: ${sent.disclosure})`
      : `Disclosure (spoken by Twilio when the callee answered): ${sent.disclosure}`,
    `Opening: ${sent.opening}`,
    `Instructions:\n${sent.instructions}`,
  ].join("\n");
}

function minutesText(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

export function createCallRoutes(deps: CallRouteDeps) {
  async function answer(action: Action, body: Record<string, unknown>, ctx: CallRouteContext): Promise<{ status: number; text?: string; error?: string }> {
    const parsed = schemas[action].safeParse(body);
    if (!parsed.success) return { status: 400, error: "Those arguments don't match the tool's fields." };
    const calls = deps.calls();
    const botId = ctx.bot.id;
    switch (action) {
      case "place": {
        const input = parsed.data as z.infer<typeof schemas.place>;
        const to = e164(input.to);
        if (!to) return { status: 400, error: "Give the number in E.164 form: + then the country code and number, like +14155550123." };
        const settings = deps.settings();
        if ("refusal" in settings) return { status: 409, error: settings.refusal };
        const refused = numberRefusal(to, settings);
        if (refused) return { status: 403, error: refused };
        const bot = { ...ctx.bot, outbound: ALWAYS_ASK };
        const calling = Object.fromEntries(Object.entries({
          to, call_type: input.call_type ?? "business", purpose: input.purpose, callee_name: input.callee_name, on_behalf_of: input.on_behalf_of,
          booking_name: input.booking_name, callback_number: input.callback_number, details: input.details, brief: input.brief,
        }).filter(([, value]) => value));
        const held = await deps.outbound().hold({ bot, threadId: ctx.threadId, tool: PLACE_CALL_TOOL, calls: [{ slug: PLACE_CALL_TOOL, arguments: calling }], opaque: false, fullAccess: false, active: ctx.active });
        if (!held.ok) return { status: 403, error: held.text };
        try {
          deps.outbound().beforeDispatch({ bot, threadId: ctx.threadId, tool: PLACE_CALL_TOOL, opaque: false, fullAccess: false, approved: held.approved });
        } catch (error) {
          return { status: 403, error: error instanceof Error ? error.message : String(error) };
        }
        if (!ctx.active()) return { status: 409, error: "This turn ended before the call was approved, so I didn't call." };
        const record = await calls.place({
          botId, botName: ctx.bot.name, threadId: ctx.threadId, to, ...(input.callee_name ? { calleeName: input.callee_name } : {}),
          brief: input.brief,
          caller: resolveCaller({
            ...(input.purpose ? { purpose: input.purpose } : {}), ...(input.call_type ? { callType: input.call_type } : {}),
            ...(input.on_behalf_of ? { onBehalfOf: input.on_behalf_of } : {}), ...(input.booking_name ? { bookingName: input.booking_name } : {}),
            ...(input.callback_number ? { callbackNumber: input.callback_number } : {}), ...(input.details ? { details: input.details } : {}),
          }, settings, deps.ownerName()?.trim() || deps.personName(ctx.threadId)?.trim()),
        });
        return {
          status: 200,
          text: `call_id ${record.id}. Calling ${to} now from ${settings.callerId} (up to ${record.maxMinutes} min). The AI voice runs the call from your brief; a card here follows it and has a Hang up button. When the call ends you get its transcript in a new turn to summarize for the person. Use call_status to check on it and hang_up to end it.`,
        };
      }
      case "status": {
        const record = calls.owned((parsed.data as z.infer<typeof schemas.status>).call_id, botId);
        const seconds = calls.seconds(record);
        const state = record.phase === "ended"
          ? `ended${record.answeredAt ? ` after ${minutesText(seconds)}` : ""}: ${CALL_END_TEXT[record.endReason ?? "completed"]}${record.endDetail ? ` (${record.endDetail})` : ""}`
          : record.phase === "in_progress" ? `on the call for ${minutesText(seconds)}` : record.phase;
        const head = `call_id ${record.id} to ${record.to}: ${state}. ${record.lines} transcript line${record.lines === 1 ? "" : "s"}.`;
        const recent = calls.lines(record.id).slice(-12);
        if (!recent.length) return { status: 200, text: head };
        deps.markOutside(ctx.threadId);
        const text = transcriptText(recent, record.answeredAt ?? record.createdAt, speakerNames(record));
        return { status: 200, text: `${head} Latest lines:\n${recordsText("the phone call transcript, spoken by the callee and the AI voice", text, 12_000)}` };
      }
      case "hang_up": {
        const record = await calls.hangUpFor((parsed.data as z.infer<typeof schemas.hang_up>).call_id, botId);
        return { status: 200, text: record.phase === "ended" ? "That call has already ended." : "Hanging up now. You get the transcript to summarize once the call is closed." };
      }
      case "transcript": {
        const input = parsed.data as z.infer<typeof schemas.transcript>;
        const record = calls.owned(input.call_id, botId);
        const all = calls.lines(record.id);
        const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
        const page = Math.min(input.page ?? 1, pages);
        const head = `call_id ${record.id} to ${record.to} (${record.phase === "ended" ? "ended" : record.phase.replace("_", " ")}). Brief: ${record.brief.replace(/\s+/g, " ").slice(0, 300)}`;
        const recording = calls.recording(record.id);
        const recorded = recording ? `\nRecording: ${recording.path} (${minutesText(recording.seconds)}, ${Math.round(recording.bytes / 1024)} KB), playable in the call's details in OpenMausBot.` : "";
        const sent = (page === 1 && record.sent ? `\n${sentText(record.sent)}` : "") + recorded;
        if (!all.length) return { status: 200, text: `${head}${sent}\nNo transcript.` };
        deps.markOutside(ctx.threadId);
        const text = transcriptText(all.slice((page - 1) * PER_PAGE, page * PER_PAGE), record.answeredAt ?? record.createdAt, speakerNames(record));
        return { status: 200, text: `${head}${sent}\nTranscript page ${page} of ${pages} (${all.length} lines):\n${recordsText("the phone call transcript, spoken by the callee and the AI voice", text, 60_000)}` };
      }
    }
  }

  return {
    async internal(ctx: CallRouteContext): Promise<typeof PASS | void> {
      if (ctx.method !== "POST" || !ctx.path.startsWith(PREFIX)) return PASS;
      const action = ctx.path.slice(PREFIX.length);
      if (!(action in schemas)) return PASS;
      try {
        const out = await answer(action as Action, await ctx.readBody(), ctx);
        ctx.json(ctx.res, out.status, out.error ? { error: out.error } : { text: out.text });
      } catch (error) {
        if (error instanceof CallError) return void ctx.json(ctx.res, error.status, { error: error.message });
        throw error;
      }
    },
  };
}

export const CALL_ROUTES = (Object.keys(schemas) as Action[]).map((action) => `POST ${PREFIX}${action}`);

export interface CallAppRouteDeps {
  calls: () => Calls;
  setup(): CallsSetup;
  sees(auth: RequestAuth, threadId: string): boolean;
}

/** The app's call history: GET /api/calls, GET /api/calls/setup, GET /api/calls/:id and POST /api/calls/:id/hang-up. */
/** One byte range of a `size`-byte file from a Range header; null for the whole file, "bad" when it can't be served. */
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | null | "bad" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return "bad";
  if (!match[1]) {
    const suffix = Number(match[2]);
    return suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : "bad";
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : "bad";
}

function sendRecording(req: IncomingMessage, res: ServerResponse, file: string, name: string, download: boolean): void {
  const size = statSync(file).size;
  const range = byteRange(typeof req.headers.range === "string" ? req.headers.range : undefined, size);
  const headers = {
    "content-type": "audio/wav", "accept-ranges": "bytes", "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    ...(download ? { "content-disposition": `attachment; filename="${name}"` } : {}),
  };
  if (range === "bad") {
    res.writeHead(416, { ...headers, "content-range": `bytes */${size}` }).end();
    return;
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  res.writeHead(range ? 206 : 200, { ...headers, "content-length": String(end - start + 1), ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}) });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file, { start, end }).on("error", () => res.destroy()).pipe(res);
}

export function createCallAppRoutes(deps: CallAppRouteDeps): RouteHandler {
  return async ({ req, method, path, url, res, json, auth }) => {
    if (!path.startsWith("/api/calls")) return PASS;
    if (method === "GET" && path === "/api/calls") {
      return void json(res, 200, { calls: deps.calls().list().filter((call) => deps.sees(auth, call.threadId)) } as never);
    }
    if (method === "GET" && path === "/api/calls/setup") return void json(res, 200, deps.setup() as never);
    const one = /^\/api\/calls\/(c-[0-9a-f-]{36})(\/hang-up|\/recording)?$/.exec(path);
    if (!one) return PASS;
    const record = deps.calls().record(one[1]!);
    if (!record || !deps.sees(auth, record.threadId)) return void json(res, 404, { error: "There is no such call." });
    if ((method === "GET" || method === "HEAD") && one[2] === "/recording") {
      const recording = deps.calls().recording(record.id);
      if (!recording) return void json(res, 404, { error: "This call has no recording on this computer." });
      return void sendRecording(req, res, recording.path, `${record.id}.wav`, url.searchParams.get("download") === "1");
    }
    if (method === "DELETE" && !one[2]) {
      deps.calls().remove(record.id);
      return void json(res, 200, { ok: true });
    }
    if (method === "GET" && !one[2]) return void json(res, 200, deps.calls().detail(record.id) as never);
    if (method === "POST" && one[2]) {
      await deps.calls().hangUp(record.id, "hung_up");
      return void json(res, 200, { ok: true });
    }
    return PASS;
  };
}
