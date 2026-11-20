// Phone calls on this server: the calls, their tools' routes, the call listener the public address reaches, the live
// card with its Hang up button, and the summary turn when a call ends.
import WebSocket from "ws";
import type { WidgetAction } from "../../shared/widget.ts";
import { createAgentCard } from "../chat-widgets.ts";
import { HANG_UP_ACTION, callCard } from "../calls/cards.ts";
import { callsNotReadyText, callsPort, callsSettings, callsSetup, type CallsConfigInput, type ReadyCalls } from "../calls/config.ts";
import { createCallIngress } from "../calls/ingress.ts";
import { createCalls, type CallRecord } from "../calls/manager.ts";
import { realtimeUrl } from "../calls/realtime.ts";
import { createCallAppRoutes, createCallRoutes, type CallRouteContext, type CallRouteDeps } from "../calls/routes.ts";
import { createTwilioProvider } from "../calls/twilio.ts";
import { OUTSIDE, type WorkOrigin } from "../peer-provenance.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { BotRecord, Store } from "../store.ts";

const BUSY_WAIT_MS = 15 * 60_000;

export interface CallsHostDeps {
  /** The live config: read on every use, so a saved setting counts at once. */
  cfg: () => CallsConfigInput;
  dataDir: string;
  store: Store;
  startTurn(botId: string, text: string, opts: { threadId: string; unattended: true; cardContinuation: true; origin: WorkOrigin }): Promise<unknown>;
  threadBusy(botId: string, threadId: string): boolean;
  sees(auth: RequestAuth, threadId: string): boolean;
  log(line: string): void;
  env?: NodeJS.ProcessEnv;
}

export type CallsHostRoutes = Omit<CallRouteDeps, "calls" | "settings" | "ownerName">;

export function createCallsHost(deps: CallsHostDeps, routeDeps: () => CallsHostRoutes) {
  const { store } = deps;
  const env = deps.env ?? process.env;
  const settings = (): ReadyCalls | { refusal: string } => callsSettings(deps.cfg()).ready ?? { refusal: callsNotReadyText(deps.cfg()) ?? "Phone calls aren't set up." };
  const speaker = (record: CallRecord) => {
    const bot = store.bot(record.botId);
    return bot ? { id: bot.id, name: bot.name, color: bot.color } : null;
  };
  const minutes = (record: CallRecord) => Math.round(calls.seconds(record) / 60);

  const calls = createCalls({
    dataDir: deps.dataDir,
    settings,
    provider: (ready) => createTwilioProvider(ready, env),
    openRealtime: (ready) => new WebSocket(realtimeUrl(ready.model, env), { headers: { authorization: `Bearer ${ready.openaiKey}` } }),
    card: {
      show(record) {
        const bot = speaker(record);
        if (!bot) return null;
        const made = createAgentCard({ store, bot, threadId: record.threadId, input: { tool: "show_widget", widget: callCard(record, 0) }, serverCard: true });
        return made.ok ? made.messageId : null;
      },
      update(record) {
        const bot = speaker(record);
        if (!bot || !record.cardMessageId) return;
        createAgentCard({ store, bot, threadId: record.threadId, input: { tool: "update_widget", widget_id: record.cardMessageId, widget: callCard(record, minutes(record)) }, serverCard: true });
      },
    },
    async followUp(record, prompt) {
      const until = Date.now() + BUSY_WAIT_MS;
      while (deps.threadBusy(record.botId, record.threadId)) {
        if (Date.now() > until) throw new Error("the conversation stayed busy");
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      routeDeps().markOutside(record.threadId);
      await deps.startTurn(record.botId, prompt, { threadId: record.threadId, unattended: true, cardContinuation: true, origin: OUTSIDE });
    },
    log: deps.log,
  });

  const ingress = createCallIngress({
    calls: () => calls,
    signing() {
      const ready = callsSettings(deps.cfg()).ready;
      return ready ? { authToken: ready.authToken, publicUrl: ready.publicUrl } : null;
    },
    log: deps.log,
  });

  let starting: Promise<boolean> | null = null;
  /** The listener starts once calls are set up: at start, when Settings → Phone calls is opened, or on the first call. */
  function listen(): Promise<boolean> {
    if (ingress.listening()) return Promise.resolve(true);
    starting ??= ingress.listen(callsPort(deps.cfg())).then((port) => {
      deps.log(`openmausbot call listener on http://127.0.0.1:${port}`);
      return true;
    }, (error: unknown) => {
      deps.log(`call listener did not start on port ${callsPort(deps.cfg())}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }).finally(() => { starting = null; });
    return starting;
  }

  const routes = createCallRoutes({
    calls: () => calls,
    settings,
    personName: (threadId) => routeDeps().personName(threadId),
    ownerName: () => deps.cfg().profile?.name,
    outbound: () => routeDeps().outbound(),
    markOutside: (threadId) => routeDeps().markOutside(threadId),
  });

  if (callsSettings(deps.cfg()).ready) void listen();
  setTimeout(() => void calls.resume(), 5_000).unref();

  return {
    async internal(ctx: CallRouteContext) {
      if (ctx.method === "POST" && ctx.path === "/api/internal/calls/place" && callsSettings(deps.cfg()).ready && !(await listen())) {
        return void ctx.json(ctx.res, 503, { error: `The call listener couldn't start on port ${callsPort(deps.cfg())}. Free that port or set another in Settings → Phone calls.` });
      }
      return routes.internal(ctx);
    },
    appRoutes: createCallAppRoutes({
      calls: () => calls,
      setup() {
        if (callsSettings(deps.cfg()).ready) void listen();
        return callsSetup(deps.cfg(), ingress.listening());
      },
      sees: deps.sees,
    }),
    /** The live card's Hang up button, handled here without a turn. */
    serverPress(bot: Pick<BotRecord, "id">, threadId: string, messageId: string, action: WidgetAction, _auth: RequestAuth): "handled" | null {
      if (action.type !== HANG_UP_ACTION || !action.payload || typeof action.payload !== "object" || Array.isArray(action.payload)) return null;
      const callId = (action.payload as { callId?: unknown }).callId;
      const record = typeof callId === "string" ? calls.record(callId) : undefined;
      const row = store.messagesFor(threadId).find((message) => message.id === messageId);
      if (!record || record.botId !== bot.id || record.cardMessageId !== messageId || row?.serverCard !== true) return null;
      void calls.hangUp(record.id, "hung_up").catch((error: unknown) => deps.log(`call ${record.id}: hang-up failed: ${String(error)}`));
      return "handled";
    },
    calls: () => calls,
    listening: () => ingress.listening(),
    async close() {
      calls.close();
      await ingress.close();
    },
  };
}

export type CallsHost = ReturnType<typeof createCallsHost>;
