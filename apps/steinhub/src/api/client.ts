import type {
  BotsResponse,
  BotUpdateResponse,
  CompanionEndpointsSnapshot,
  InstancesResponse,
  TaskResponse,
  WireMessagePage,
} from "@openmausbot/phone-protocol/responses.ts";
import type { Routine, RoutineRun } from "@openmausbot/phone-protocol/routines.ts";
import type { ServerFrame, WireBot, WireMessage } from "@openmausbot/phone-protocol/wire.ts";
import { createSseParser } from "@/api/sse";
import type { Transport } from "@/api/transport";

/** POST /api/bots/:id/messages. phone-protocol has no type for this reply yet. */
export interface SendReply {
  threadId?: string;
  message?: WireMessage;
  queued?: boolean;
  queueId?: string;
}

/** GET /api/routines. phone-protocol has no type for this reply yet. */
export interface RoutinesReply {
  routines: Routine[];
  runs: RoutineRun[];
}

export interface StreamFrame {
  frame: ServerFrame;
  /** The SSE `id`, the cursor a reconnect resumes from. */
  cursor?: string;
}

const id = encodeURIComponent;

function parseFrame(data: string): ServerFrame | null {
  try {
    const parsed: unknown = JSON.parse(data);
    // SAFETY: only `kind` is checked here; each consumer reads the fields its kind promises.
    return parsed && typeof parsed === "object" && "kind" in parsed ? (parsed as ServerFrame) : null;
  } catch {
    return null;
  }
}

/** Every desktop route SteinHub uses, typed by phone-protocol. Each is on the companion's allowlist. */
export function desktopClient(transport: Transport) {
  return {
    baseUrl: transport.baseUrl,
    endpoints: () => transport.request<CompanionEndpointsSnapshot>("GET", "/api/companion/endpoints"),
    bots: () => transport.request<BotsResponse>("GET", "/api/bots?messages=0"),
    instances: () => transport.request<InstancesResponse>("GET", "/api/instances"),
    messages: (threadId: string, options: { limit?: number; before?: string } = {}) => {
      const query = new URLSearchParams();
      if (options.limit) query.set("limit", String(options.limit));
      if (options.before) query.set("before", options.before);
      const suffix = query.toString() ? `?${query}` : "";
      return transport.request<WireMessagePage>("GET", `/api/threads/${id(threadId)}/messages${suffix}`);
    },
    newThread: (botId: string, folderId?: string) =>
      transport.request<TaskResponse>("POST", `/api/bots/${id(botId)}/tasks`, folderId ? { projectId: folderId } : {}),
    newFolder: (botId: string, folder: { name: string; emoji?: string }) =>
      transport.request<{ bot: WireBot }>("POST", `/api/bots/${id(botId)}/projects`, folder),
    setPinned: (botId: string, pinned: boolean) => transport.request<BotUpdateResponse>("PATCH", `/api/bots/${id(botId)}`, { pinned }),
    markRead: (botId: string, threadId: string) => transport.request<{ bot: WireBot }>("POST", `/api/bots/${id(botId)}/read`, { threadId }),
    deleteBot: (botId: string) => transport.request<unknown>("DELETE", `/api/bots/${id(botId)}`),
    send: (botId: string, message: { text: string; threadId: string; sendId: string }) =>
      transport.request<SendReply>("POST", `/api/bots/${id(botId)}/messages`, message),
    interrupt: (botId: string, threadId: string) =>
      transport.request<unknown>("POST", `/api/bots/${id(botId)}/interrupt`, { threadId }),
    respond: (threadId: string, answer: { requestId: string; behavior: "allow" | "deny" | "answer"; message?: string }) =>
      transport.request<unknown>("POST", `/api/threads/${id(threadId)}/respond`, answer),
    uploadImage: (bytes: Uint8Array<ArrayBuffer>, mime: string, uploadId: string) =>
      transport.upload<{ path: string; mime: string; bytes: number }>(`/api/attachments?uploadId=${id(uploadId)}`, bytes, mime),
    uploadFile: (bytes: Uint8Array<ArrayBuffer>, mime: string, name: string, uploadId: string) =>
      transport.upload<{ path: string; name: string; bytes: number }>(`/api/files?name=${id(name)}&uploadId=${id(uploadId)}`, bytes, mime),
    routines: () => transport.request<RoutinesReply>("GET", "/api/routines"),
    setRoutineEnabled: (routineId: string, enabled: boolean) =>
      transport.request<{ routine: Routine }>("PATCH", `/api/routines/${id(routineId)}`, { enabled }),
    runRoutine: (routineId: string) => transport.request<unknown>("POST", `/api/routines/${id(routineId)}/run`, {}),
    /** The live stream, without screen frames: a phone draws no live desktop yet. */
    events: (since: string | null, onFrame: (frame: StreamFrame) => void, signal: AbortSignal) => {
      const query = new URLSearchParams({ screens: "off" });
      if (since) query.set("since", since);
      const parser = createSseParser((event) => {
        const frame = parseFrame(event.data);
        if (frame) onFrame({ frame, cursor: event.id });
      });
      return transport.stream(`/api/events?${query}`, (text) => parser.push(text), signal);
    },
  };
}

export type DesktopClient = ReturnType<typeof desktopClient>;
