import type {
  BotsResponse,
  BotUpdateResponse,
  CompanionEndpointsSnapshot,
  InstancesResponse,
  TaskResponse,
  WireMessagePage,
} from "@openmausbot/phone-protocol/responses.ts";
import type { NewCardInput, VaultCard } from "@openmausbot/phone-protocol/payment-card.ts";
import { PHONE_PUSH_ROUTE, type PhonePushAnswer, type PhonePushRegistration } from "@openmausbot/phone-protocol/phone-push.ts";
import type { InboxView } from "@openmausbot/phone-protocol/inbox.ts";
import type { Routine, RoutineRun } from "@openmausbot/phone-protocol/routines.ts";
import type { WidgetValues } from "@openmausbot/phone-protocol/widget.ts";
import type { ServerFrame, WireBot, WireMessage } from "@openmausbot/phone-protocol/wire.ts";
import { createSseParser } from "@/api/sse";
import type { Transport } from "@/api/transport";

/** POST /api/bots/:id/messages. phone-protocol has no type for this reply yet. */
export interface SendReply {
  threadId?: string;
  message?: WireMessage;
  queued?: boolean;
  queueId?: string;
  /** The computer answered a widget press itself (Dismiss, for one) and started no turn. */
  handled?: boolean;
}

/** A press on a widget button: `ref` names the button in revision `rev` of the widget in message `messageId`. */
export interface WidgetPress {
  messageId: string;
  ref: string;
  rev: number;
  values?: WidgetValues;
}

/** GET /api/routines. phone-protocol has no type for this reply yet. */
export interface RoutinesReply {
  routines: Routine[];
  runs: RoutineRun[];
}

/** One app on GET /api/connectors/catalog. phone-protocol has no type for this reply yet. */
export interface AppCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  /** Apps such as public search need no sign-in. */
  noAuth?: boolean;
  categories?: string[];
}

export interface AppCatalogReply {
  /** False until the computer has connected apps set up. */
  configured: boolean;
  cards: AppCard[];
}

export interface AppAccount {
  id: string;
  alias?: string | null;
  status?: string;
}

/** One app's sign-in state on GET /api/connectors/connected and GET /api/connectors?services=. */
export interface AppConnection {
  connected: boolean;
  pending?: boolean;
  accounts?: AppAccount[];
}

export interface AppConnectionsReply {
  configured: boolean;
  services: Record<string, AppConnection>;
}

/** Which bots may use a saved item: every bot, or the ones named. */
export type VaultBots = "all" | string[];

/** One saved login on GET /api/vault: never its password. phone-protocol has no type for this reply yet. */
export interface VaultLogin {
  id: string;
  site: string;
  hosts: string[];
  username: string;
  hasTotp: boolean;
  source: "card" | "settings" | "1password";
  bots: VaultBots;
  lastUsedAt?: number;
}

/** One saved or linked secret on GET /api/vault: its name only. */
export interface VaultSecretRow {
  id: string;
  name: string;
  source: "card" | "settings" | "linked";
  /** Who a linked one comes from, such as 1password. */
  provider?: string;
  bots: VaultBots;
  lastUsedAt?: number;
}

export interface VaultReply {
  logins: VaultLogin[];
  secrets: VaultSecretRow[];
  /** Absent from a computer that keeps no cards yet. */
  cards?: VaultCard[];
}

export type NewVaultItem =
  | { kind: "login"; site: string; username: string; password: string; totp?: string; bots: VaultBots }
  | { kind: "secret"; name: string; value: string; bots: VaultBots }
  | ({ kind: "card" } & NewCardInput);

export type VaultKind = NewVaultItem["kind"];

const VAULT_PATHS: Record<VaultKind, string> = { login: "/api/logins", secret: "/api/vault/secrets", card: "/api/vault/cards" };

/** One Markdown file of a bot's memory on GET /api/bots/:id/memory. phone-protocol has no type for this reply yet. */
export interface MemoryFile {
  /** Relative to the bot's folder, such as memory/people.md. */
  path: string;
  name: string;
  bytes: number;
  modifiedAt: number;
}

/** GET /api/bots/:id/memory: its MEMORY.md, and the topic and log files beside it. */
export interface MemoryReply {
  /** MEMORY.md; a server that no longer sends it here answers it at /memory/file. */
  text: string;
  topics: MemoryFile[];
  logs: MemoryFile[];
}

/** GET /api/bots/:id/memory/file?path=. */
export interface MemoryDocReply {
  path: string;
  text: string;
  exists: boolean;
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

/** Every desktop route SteinHub uses, typed by phone-protocol. */
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
    /** The bot's default model and its selected conversation's; the computer refuses a model it can't run now. */
    setModel: (botId: string, modelSelection: { instanceId: string; model: string }) =>
      transport.request<BotUpdateResponse>("PATCH", `/api/bots/${id(botId)}`, { modelSelection, requireAvailableModel: true }),
    markRead: (botId: string, threadId: string) => transport.request<{ bot: WireBot }>("POST", `/api/bots/${id(botId)}/read`, { threadId }),
    deleteBot: (botId: string) => transport.request<unknown>("DELETE", `/api/bots/${id(botId)}`),
    send: (botId: string, message: { text: string; threadId: string; sendId: string }) =>
      transport.request<SendReply>("POST", `/api/bots/${id(botId)}/messages`, message),
    pressWidget: (botId: string, press: { threadId: string; sendId: string; widgetAction: WidgetPress }) =>
      transport.request<SendReply>("POST", `/api/bots/${id(botId)}/messages`, press),
    interrupt: (botId: string, threadId: string) =>
      transport.request<unknown>("POST", `/api/bots/${id(botId)}/interrupt`, { threadId }),
    respond: (threadId: string, answer: { requestId: string; behavior: "allow" | "deny" | "answer"; message?: string }) =>
      transport.request<unknown>("POST", `/api/threads/${id(threadId)}/respond`, answer),
    uploadImage: (bytes: Uint8Array<ArrayBuffer>, mime: string, uploadId: string) =>
      transport.upload<{ path: string; mime: string; bytes: number }>(`/api/attachments?uploadId=${id(uploadId)}`, bytes, mime),
    uploadFile: (bytes: Uint8Array<ArrayBuffer>, mime: string, name: string, uploadId: string) =>
      transport.upload<{ path: string; name: string; bytes: number }>(`/api/files?name=${id(name)}&uploadId=${id(uploadId)}`, bytes, mime),
    routines: () => transport.request<RoutinesReply>("GET", "/api/routines"),
    appCatalog: () => transport.request<AppCatalogReply>("GET", "/api/connectors/catalog"),
    connectedApps: () => transport.request<AppConnectionsReply>("GET", "/api/connectors/connected"),
    appStatus: (slug: string) => transport.request<AppConnectionsReply>("GET", `/api/connectors?services=${id(slug)}`),
    /** The sign-in page for a new account of `slug`; `alias` names it when the app already has one. */
    connectApp: (slug: string, alias?: string) =>
      transport.request<{ url?: string }>("POST", `/api/connectors/${id(slug)}/authorize`, alias ? { alias } : {}),
    setRoutineEnabled: (routineId: string, enabled: boolean) =>
      transport.request<{ routine: Routine }>("PATCH", `/api/routines/${id(routineId)}`, { enabled }),
    runRoutine: (routineId: string) => transport.request<unknown>("POST", `/api/routines/${id(routineId)}/run`, {}),
    pushDevice: () => transport.request<PhonePushAnswer>("GET", PHONE_PUSH_ROUTE),
    registerPush: (registration: PhonePushRegistration) => transport.request<PhonePushAnswer>("PUT", PHONE_PUSH_ROUTE, registration),
    vault: () => transport.request<VaultReply>("GET", "/api/vault"),
    addToVault: ({ kind, ...fields }: NewVaultItem) => transport.request<unknown>("POST", VAULT_PATHS[kind], fields),
    removeFromVault: (kind: VaultKind, itemId: string) => transport.request<unknown>("DELETE", `${VAULT_PATHS[kind]}/${id(itemId)}`),
    // The desktop companion's allowlist leaves out memory and the inbox; a server the phone paired with directly serves both.
    memory: (botId: string) => transport.request<MemoryReply>("GET", `/api/bots/${id(botId)}/memory`),
    memoryFile: (botId: string, path: string) =>
      transport.request<MemoryDocReply>("GET", `/api/bots/${id(botId)}/memory/file?path=${id(path)}`),
    inbox: () => transport.request<InboxView>("GET", "/api/inbox"),
    inboxReadAll: () => transport.request<InboxView>("POST", "/api/inbox/read-all", {}),
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
