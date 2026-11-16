import type { BotsResponse, CompanionEndpointsSnapshot, InstancesResponse, WireMessagePage } from "@openmausbot/phone-protocol/responses.ts";
import type { Routine, RoutineRun } from "@openmausbot/phone-protocol/routines.ts";
import type { ServerFrame, WireBot, WireMessage } from "@openmausbot/phone-protocol/wire.ts";
import type { RoutinesReply } from "@/api/client";

export interface ThreadState {
  messages: WireMessage[];
  hasMore: boolean;
  loaded: boolean;
}

/** A reply still streaming in, keyed by the item id the server streams it under. */
export interface StreamingItem {
  key: string;
  text: string;
}

/** A line the person sent that the computer hasn't echoed back yet. */
export interface PendingSend {
  sendId: string;
  text: string;
  failed?: boolean;
}

export interface LiveWorld {
  bots: WireBot[];
  /** The computer's sidebar sections, in its order. */
  sections: string[];
  threads: Record<string, ThreadState>;
  streaming: Record<string, StreamingItem[]>;
  pending: Record<string, PendingSend[]>;
  routines: Routine[];
  runs: RoutineRun[];
  routinesLoaded: boolean;
  /** Model id → its label in the engine's picker. */
  modelLabels: Record<string, string>;
  host: { serverName: string; version?: string } | null;
}

export const emptyWorld: LiveWorld = {
  bots: [],
  sections: [],
  threads: {},
  streaming: {},
  pending: {},
  routines: [],
  runs: [],
  routinesLoaded: false,
  modelLabels: {},
  host: null,
};

export type WorldAction =
  | { type: "reset" }
  | { type: "bots"; reply: BotsResponse }
  | { type: "instances"; reply: InstancesResponse }
  | { type: "routines"; reply: RoutinesReply }
  | { type: "host"; snapshot: CompanionEndpointsSnapshot }
  | { type: "page"; threadId: string; page: WireMessagePage; older?: boolean }
  | { type: "sending"; threadId: string; send: PendingSend }
  | { type: "sendFailed"; threadId: string; sendId: string }
  | { type: "sendDropped"; threadId: string; sendId: string }
  | { type: "message"; threadId: string; message: WireMessage }
  | { type: "routine"; routine: Routine }
  | { type: "frame"; frame: ServerFrame };

const MAX_MESSAGES = 400;

function upsert<T>(items: readonly T[], item: T, same: (a: T, b: T) => boolean): T[] {
  const index = items.findIndex((existing) => same(existing, item));
  if (index === -1) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
}

function withMessage(world: LiveWorld, threadId: string, message: WireMessage): LiveWorld {
  const thread = world.threads[threadId] ?? { messages: [], hasMore: false, loaded: false };
  const messages = upsert(thread.messages, message, (a, b) => a.id === b.id).slice(-MAX_MESSAGES);
  const streaming = world.streaming[threadId];
  const pending = world.pending[threadId];
  return {
    ...world,
    threads: { ...world.threads, [threadId]: { ...thread, messages } },
    streaming:
      streaming && message.itemId
        ? { ...world.streaming, [threadId]: streaming.filter((item) => item.key !== message.itemId) }
        : world.streaming,
    pending:
      pending && message.sendId
        ? { ...world.pending, [threadId]: pending.filter((send) => send.sendId !== message.sendId) }
        : world.pending,
  };
}

/** A bot from a reply that leaves out its conversations keeps the ones already known. */
function botsWithFrame(bots: readonly WireBot[], bot: WireBot): WireBot[] {
  const known = bots.find((existing) => existing.id === bot.id);
  return upsert(bots, known && bot.tasks === undefined ? { ...bot, tasks: known.tasks } : bot, (a, b) => a.id === b.id);
}

function withRuntime(world: LiveWorld, frame: Extract<ServerFrame, { kind: "runtime" }>): LiveWorld {
  const event = frame.event;
  const threadId = event.threadId;
  if (event.type === "content.delta" && event.streamKind === "assistant_text") {
    const key = event.itemId ?? event.turnId ?? "live";
    const items = world.streaming[threadId] ?? [];
    const existing = items.find((item) => item.key === key);
    const next = existing
      ? items.map((item) => (item.key === key ? { ...item, text: item.text + event.delta } : item))
      : [...items, { key, text: event.delta }];
    return { ...world, streaming: { ...world.streaming, [threadId]: next } };
  }
  const turnEnded =
    event.type === "turn.completed" ||
    event.type === "session.exited" ||
    event.type === "cap.exhausted" ||
    (event.type === "runtime.error" && event.terminal === true);
  if (turnEnded && world.streaming[threadId]) {
    const { [threadId]: _ended, ...rest } = world.streaming;
    return { ...world, streaming: rest };
  }
  return world;
}

export function worldReducer(world: LiveWorld, action: WorldAction): LiveWorld {
  switch (action.type) {
    case "reset":
      return emptyWorld;
    case "bots":
      return {
        ...world,
        bots: action.reply.bots.map(({ messages: _messages, hasMore: _more, activeLeafId: _leaf, ...bot }) => bot),
        sections: action.reply.sections,
      };
    case "instances": {
      const modelLabels: Record<string, string> = {};
      for (const instance of action.reply.instances) {
        for (const option of instance.models.options) modelLabels[option.id] = option.label;
      }
      return { ...world, modelLabels };
    }
    case "routines":
      return { ...world, routines: action.reply.routines, runs: action.reply.runs, routinesLoaded: true };
    case "host":
      return { ...world, host: { serverName: action.snapshot.serverName, version: action.snapshot.version } };
    case "page": {
      const current = world.threads[action.threadId];
      const fresh = new Set(action.page.messages.map((message) => message.id));
      const messages = [...action.page.messages, ...(current?.messages ?? []).filter((message) => !fresh.has(message.id))]
        .map((message, index) => ({ message, index }))
        .sort((a, b) => a.message.at - b.message.at || a.index - b.index)
        .map(({ message }) => message);
      const hasMore = action.older || !current?.loaded ? action.page.hasMore === true : current.hasMore;
      return { ...world, threads: { ...world.threads, [action.threadId]: { messages, hasMore, loaded: true } } };
    }
    case "sending":
      return {
        ...world,
        pending: { ...world.pending, [action.threadId]: [...(world.pending[action.threadId] ?? []), action.send] },
      };
    case "sendFailed":
      return {
        ...world,
        pending: {
          ...world.pending,
          [action.threadId]: (world.pending[action.threadId] ?? []).map((send) =>
            send.sendId === action.sendId ? { ...send, failed: true } : send,
          ),
        },
      };
    case "sendDropped":
      return {
        ...world,
        pending: {
          ...world.pending,
          [action.threadId]: (world.pending[action.threadId] ?? []).filter((send) => send.sendId !== action.sendId),
        },
      };
    case "message":
      return withMessage(world, action.threadId, action.message);
    case "routine":
      return { ...world, routines: upsert(world.routines, action.routine, (a, b) => a.id === b.id) };
    case "frame": {
      const frame = action.frame;
      switch (frame.kind) {
        case "bot":
          return { ...world, bots: botsWithFrame(world.bots, frame.bot) };
        case "sections":
          return { ...world, sections: frame.sections };
        case "bot.deleted":
          return { ...world, bots: world.bots.filter((bot) => bot.id !== frame.botId) };
        case "bots.order": {
          const rank = new Map(frame.botIds.map((botId, index) => [botId, index]));
          return { ...world, bots: [...world.bots].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9)) };
        }
        case "message":
        case "message.patch":
          return withMessage(world, frame.threadId, frame.message);
        case "runtime":
          return withRuntime(world, frame);
        case "routine":
          return { ...world, routines: upsert(world.routines, frame.routine, (a, b) => a.id === b.id) };
        case "routine.deleted":
          return { ...world, routines: world.routines.filter((routine) => routine.id !== frame.routineId) };
        case "routine.run":
          return { ...world, runs: upsert(world.runs, frame.run, (a, b) => a.id === b.id) };
        case "companion.endpoints":
          return { ...world, host: { serverName: frame.serverName, version: frame.version } };
        default:
          return world;
      }
    }
  }
}
