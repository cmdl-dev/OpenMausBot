// The call tools' routes, called by the agents server on a bot's turn, and the app's call history routes.
import type { ServerResponse } from "node:http";
import { z } from "zod";
import { CALL_END_TEXT, e164, numberRefusal, type CallsSetup } from "../../shared/phone-calls.ts";
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
  outbound: () => Pick<OutboundHold, "hold" | "beforeDispatch">;
  /** Text written by people outside reaches this conversation. */
  markOutside(threadId: string): void;
}

const callId = z.string().min(1).max(80);
const schemas = {
  place: z.object({ to: z.string().trim().min(3).max(40), brief: z.string().trim().min(10).max(4_000), callee_name: z.string().trim().max(80).optional() }),
  status: z.object({ call_id: callId }),
  hang_up: z.object({ call_id: callId }),
  transcript: z.object({ call_id: callId, page: z.number().int().min(1).optional() }),
};
type Action = keyof typeof schemas;
const PREFIX = "/api/internal/calls/";
const PER_PAGE = 200;

/** Every call asks the person, whatever the bot's sending rule or access level: a phone call rings a real person. */
const ALWAYS_ASK = { policy: "ask" } as const;

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
        const calling = { to, ...(input.callee_name ? { callee_name: input.callee_name } : {}), brief: input.brief };
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
          brief: input.brief, onBehalfOf: deps.personName(ctx.threadId) || "the person I work for",
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
        if (!all.length) return { status: 200, text: `${head}\nNo transcript.` };
        deps.markOutside(ctx.threadId);
        const text = transcriptText(all.slice((page - 1) * PER_PAGE, page * PER_PAGE), record.answeredAt ?? record.createdAt, speakerNames(record));
        return { status: 200, text: `${head}\nTranscript page ${page} of ${pages} (${all.length} lines):\n${recordsText("the phone call transcript, spoken by the callee and the AI voice", text, 60_000)}` };
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
export function createCallAppRoutes(deps: CallAppRouteDeps): RouteHandler {
  return async ({ method, path, res, json, auth }) => {
    if (!path.startsWith("/api/calls")) return PASS;
    if (method === "GET" && path === "/api/calls") {
      return void json(res, 200, { calls: deps.calls().list().filter((call) => deps.sees(auth, call.threadId)) } as never);
    }
    if (method === "GET" && path === "/api/calls/setup") return void json(res, 200, deps.setup() as never);
    const one = /^\/api\/calls\/(c-[0-9a-f-]{36})(\/hang-up)?$/.exec(path);
    if (!one) return PASS;
    const record = deps.calls().record(one[1]!);
    if (!record || !deps.sees(auth, record.threadId)) return void json(res, 404, { error: "There is no such call." });
    if (method === "GET" && !one[2]) return void json(res, 200, deps.calls().detail(record.id) as never);
    if (method === "POST" && one[2]) {
      await deps.calls().hangUp(record.id, "hung_up");
      return void json(res, 200, { ok: true });
    }
    return PASS;
  };
}
