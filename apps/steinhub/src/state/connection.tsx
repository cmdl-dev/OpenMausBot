import { FILE_MAX_BYTES, limitMegabytes } from "@openmausbot/phone-protocol/upload-limits.ts";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import type { SentAttachment } from "@/api/attachments";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { PhonePushAnswer, PhonePushRegistration } from "@openmausbot/phone-protocol/phone-push.ts";
import {
  desktopClient,
  type AppCatalogReply,
  type AppConnection,
  type AppConnectionsReply,
  type DesktopClient,
  type NewVaultItem,
  type VaultKind,
  type VaultReply,
  type MemoryDocReply,
  type MemoryReply,
} from "@/api/client";
import { asDesktopError, type DesktopError } from "@/api/errors";
import { startLiveEvents, type LiveEvents, type LinkState } from "@/api/live-events";
import { pair, type PairingInvite } from "@/api/pairing";
import { clearSession, loadDemoChoice, loadSession, saveDemoChoice, saveSession, type Session } from "@/api/session";
import { httpTransport } from "@/api/transport";
import { emptyWorld, worldReducer, type LiveWorld } from "@/state/live-world";

export type Mode = "loading" | "demo" | "live" | "unpaired";

export interface Connection {
  mode: Mode;
  /** Demo mode exists only in development builds. */
  demoAvailable: boolean;
  link: LinkState;
  problem: DesktopError | null;
  session: Session | null;
  world: LiveWorld;
  setDemo(on: boolean): Promise<void>;
  pairWith(invite: PairingInvite, deviceName: string): Promise<void>;
  forget(): Promise<void>;
  retry(): void;
  loadThread(threadId: string, options?: { older?: boolean }): Promise<void>;
  /** Sends into `threadId`, or into a new conversation with the bot when null. Resolves to the thread it went to. */
  send(botId: string, threadId: string | null, text: string): Promise<string>;
  stop(botId: string, threadId: string): Promise<void>;
  respond(threadId: string, requestId: string, answer: { behavior: "allow" | "deny" | "answer"; message?: string }): Promise<void>;
  setRoutineEnabled(routineId: string, enabled: boolean): Promise<void>;
  /** Stores a picked photo or file on the computer, ready to send with a message. */
  upload(pick: { uri: string; name: string; mime: string; kind: "image" | "file" }): Promise<SentAttachment>;
  /** A new conversation with the bot, in a folder when given. Resolves to its thread. */
  newThread(botId: string, folderId?: string): Promise<string>;
  newFolder(botId: string, folder: { name: string; emoji?: string }): Promise<void>;
  setPinned(botId: string, pinned: boolean): Promise<void>;
  setModel(botId: string, selection: { instanceId: string; model: string }): Promise<void>;
  markRead(botId: string, threadId: string): Promise<void>;
  deleteBot(botId: string): Promise<void>;
  /** An `/api/attachments/…` path as an image source on the paired computer, with this device's token. */
  attachmentSource(path: string): { uri: string; headers: Record<string, string> } | null;
  runRoutine(routineId: string): Promise<void>;
  /** Every app the computer can connect, and the ones it has. */
  apps(): Promise<{ catalog: AppCatalogReply; connected: AppConnectionsReply }>;
  appStatus(slug: string): Promise<AppConnection | null>;
  /** Starts a sign-in on the computer and resolves to the page the person finishes it on. */
  connectApp(slug: string, alias?: string): Promise<string>;
  /** Registers this phone for pushes with the computer, or updates what it asks for. */
  registerPush(registration: PhonePushRegistration): Promise<PhonePushAnswer>;
  /** The Vault's logins, secrets and cards, by name only: no value ever comes back. */
  vault(): Promise<VaultReply>;
  /** Sends a value to the computer's Vault once. */
  addToVault(item: NewVaultItem): Promise<void>;
  removeFromVault(kind: VaultKind, id: string): Promise<void>;
  /** Reads the computer's inbox again; one that serves none to this phone leaves the sample. */
  refreshInbox(): Promise<void>;
  markInboxRead(): Promise<void>;
  /** What a bot remembers: its MEMORY.md and the files beside it. */
  memory(botId: string): Promise<MemoryReply>;
  memoryFile(botId: string, path: string): Promise<MemoryDocReply>;
}

const ConnectionContext = createContext<Connection | null>(null);

const DEMO_AVAILABLE = __DEV__;

/** The demo world's apps, named as in `designs/README.md`'s sample world. */
const SAMPLE_APPS: { catalog: AppCatalogReply; connected: AppConnectionsReply } = {
  catalog: {
    configured: true,
    cards: [
      { slug: "gmail", label: "Gmail", blurb: "Read, search and draft email.", logo: null, categories: ["email"] },
      { slug: "googlecalendar", label: "Google Calendar", blurb: "See and plan events.", logo: null, categories: ["calendar"] },
      { slug: "slack", label: "Slack", blurb: "Read and post in channels.", logo: null, categories: ["chat"] },
      { slug: "github", label: "GitHub", blurb: "Issues, pull requests and code.", logo: null, categories: ["developer tools"] },
    ],
  },
  connected: { configured: true, services: { gmail: { connected: true, accounts: [{ id: "a1", alias: "Personal", status: "ACTIVE" }] } } },
};
/** The demo world's Vault. Card numbers are the networks' published test numbers. */
const SAMPLE_VAULT: VaultReply = {
  logins: [{ id: "l1", site: "zillow.com", hosts: ["zillow.com"], username: "ada@example.com", hasTotp: true, source: "settings", bots: "all", lastUsedAt: Date.now() - 86_400_000 }],
  secrets: [{ id: "s1", name: "Stripe secret key", source: "card", bots: "all" }],
  cards: [{ id: "c1", name: "Personal Visa", brand: "visa", last4: "4242", expMonth: 8, expYear: 2029, hasCvc: true, bots: "all", createdAt: 1, updatedAt: 1 }],
};
/** The demo world's memory: every sample bot remembers the same few things about Alex. */
const SAMPLE_MEMORY: MemoryReply = {
  text: "# What I remember\n\n- Alex likes a short morning brief, before 8:00.\n- The lease renews in December. Section 4.2 caps a renewal increase at 5%.\n- Who's who is in people.md.",
  topics: [{ path: "memory/people.md", name: "people.md", bytes: 96, modifiedAt: Date.UTC(2026, 10, 14) }],
  logs: [],
};
const SAMPLE_MEMORY_FILES: Record<string, string> = {
  "memory/people.md": "# People\n\n- **Jordan**, the landlord. Prefers email.\n- **Sam**, the accountant. Files the quarterly taxes.",
};
const PAGE_SIZE = 60;

function startingMode(session: Session | null, demoChoice: boolean | null): Mode {
  if (DEMO_AVAILABLE && (demoChoice === true || (demoChoice === null && !session))) return "demo";
  return session ? "live" : "unpaired";
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [link, setLink] = useState<LinkState>("connecting");
  const [problem, setProblem] = useState<DesktopError | null>(null);
  const [world, dispatch] = useReducer(worldReducer, emptyWorld);
  const urlIndex = useRef(0);
  const live = useRef<LiveEvents | null>(null);
  const loadedThreads = useRef(new Set<string>());
  const threadsNow = useRef(world.threads);
  useEffect(() => {
    threadsNow.current = world.threads;
  }, [world.threads]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSession().catch(() => null), loadDemoChoice().catch(() => null)]).then(([stored, demo]) => {
      if (cancelled) return;
      setSession(stored);
      setMode(startingMode(stored, demo));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const client = useCallback((): DesktopClient => {
    if (!session) throw new Error("not paired");
    const baseUrl = session.urls[urlIndex.current % session.urls.length];
    return desktopClient(httpTransport({ baseUrl, token: session.token }));
  }, [session]);

  const snapshot = useCallback(async () => {
    const api = client();
    const [bots, instances, routines, host, inbox] = await Promise.all([
      api.bots(),
      api.instances().catch(() => null),
      api.routines().catch(() => null),
      api.endpoints().catch(() => null),
      api.inbox().catch(() => null),
    ]);
    dispatch({ type: "bots", reply: bots });
    if (instances) dispatch({ type: "instances", reply: instances });
    if (routines) dispatch({ type: "routines", reply: routines });
    if (host) dispatch({ type: "host", snapshot: host });
    if (inbox) dispatch({ type: "inbox", view: inbox });
    await Promise.all(
      [...loadedThreads.current].map((threadId) =>
        api.messages(threadId, { limit: PAGE_SIZE }).then(
          (page) => dispatch({ type: "page", threadId, page }),
          () => undefined,
        ),
      ),
    );
  }, [client]);

  const refreshInbox = useCallback(async () => {
    if (mode !== "live" || !session) return;
    const view = await client().inbox().catch(() => null);
    if (view) dispatch({ type: "inbox", view });
  }, [mode, session, client]);

  useEffect(() => {
    if (mode !== "live" || !session) return;
    const events = startLiveEvents({
      open: (since, onFrame, signal) => client().events(since, onFrame, signal),
      snapshot,
      onFrame: (frame) => {
        dispatch({ type: "frame", frame });
        if (frame.kind === "notify") void refreshInbox();
        if (frame.kind === "companion.endpoints") {
          const urls = [...new Set([...session.urls, ...frame.endpoints.map((endpoint) => endpoint.url)])];
          if (urls.length !== session.urls.length) void saveSession({ ...session, urls, serverName: frame.serverName });
        }
      },
      onState: (state, error) => {
        setLink(state);
        setProblem(state === "online" || state === "connecting" ? null : (error ?? null));
      },
      onUnreachable: () => {
        urlIndex.current += 1;
      },
    });
    live.current = events;
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") events.retryNow();
    });
    return () => {
      foreground.remove();
      events.stop();
      live.current = null;
    };
  }, [mode, session, client, snapshot, refreshInbox]);

  const setDemo = useCallback(
    async (on: boolean) => {
      if (!DEMO_AVAILABLE) return;
      await saveDemoChoice(on);
      setMode(on ? "demo" : session ? "live" : "unpaired");
    },
    [session],
  );

  const pairWith = useCallback(
    async (invite: PairingInvite, deviceName: string) => {
      const paired = await pair(invite, {
        deviceName,
        requestId: Crypto.randomUUID(),
        replacesToken: session?.token,
      });
      const next: Session = {
        token: paired.response.token,
        urls: paired.urls,
        serverName: paired.response.serverName,
        device: paired.response.device,
        pairedAt: Date.now(),
      };
      await saveSession(next);
      if (DEMO_AVAILABLE) await saveDemoChoice(false);
      urlIndex.current = 0;
      loadedThreads.current.clear();
      dispatch({ type: "reset" });
      setLink("connecting");
      setSession(next);
      setMode("live");
    },
    [session],
  );

  const forget = useCallback(async () => {
    await clearSession();
    loadedThreads.current.clear();
    dispatch({ type: "reset" });
    setSession(null);
    setMode("unpaired");
  }, []);

  const loadThread = useCallback(
    async (threadId: string, options: { older?: boolean } = {}) => {
      if (mode !== "live") return;
      loadedThreads.current.add(threadId);
      const before = options.older ? threadsNow.current[threadId]?.messages[0]?.id : undefined;
      const page = await client().messages(threadId, { limit: PAGE_SIZE, before });
      dispatch({ type: "page", threadId, page, older: options.older });
    },
    [mode, client],
  );

  const send = useCallback(
    async (botId: string, threadId: string | null, text: string) => {
      const api = client();
      let target = threadId;
      if (!target) {
        const created = await api.newThread(botId);
        dispatch({ type: "frame", frame: { kind: "bot", bot: created.bot } });
        target = created.task.threadId;
      }
      loadedThreads.current.add(target);
      const sendId = Crypto.randomUUID();
      dispatch({ type: "sending", threadId: target, send: { sendId, text } });
      try {
        const reply = await api.send(botId, { text, threadId: target, sendId });
        if (reply.message) dispatch({ type: "message", threadId: reply.threadId ?? target, message: reply.message });
      } catch (error) {
        dispatch({ type: "sendFailed", threadId: target, sendId });
        throw asDesktopError(error);
      }
      return target;
    },
    [client],
  );

  const stop = useCallback(
    async (botId: string, threadId: string) => {
      await client().interrupt(botId, threadId);
    },
    [client],
  );

  const respond = useCallback<Connection["respond"]>(
    async (threadId, requestId, answer) => {
      await client().respond(threadId, { requestId, ...answer });
      await refreshInbox();
    },
    [client, refreshInbox],
  );

  const markInboxRead = useCallback(async () => {
    dispatch({ type: "inbox", view: await client().inboxReadAll() });
  }, [client]);

  const memory = useCallback(
    async (botId: string) => {
      if (mode === "demo") return SAMPLE_MEMORY;
      const api = client();
      const reply = await api.memory(botId);
      return typeof reply.text === "string" ? reply : { ...reply, text: (await api.memoryFile(botId, "MEMORY.md")).text };
    },
    [mode, client],
  );

  const memoryFile = useCallback(
    async (botId: string, path: string) =>
      mode === "demo" ? { path, text: SAMPLE_MEMORY_FILES[path] ?? "", exists: path in SAMPLE_MEMORY_FILES } : await client().memoryFile(botId, path),
    [mode, client],
  );

  const setRoutineEnabled = useCallback(
    async (routineId: string, enabled: boolean) => {
      const reply = await client().setRoutineEnabled(routineId, enabled);
      if (reply?.routine) dispatch({ type: "routine", routine: reply.routine });
    },
    [client],
  );

  const apps = useCallback(async () => {
    if (mode === "demo") return SAMPLE_APPS;
    const api = client();
    const [catalog, connected] = await Promise.all([api.appCatalog(), api.connectedApps()]);
    return { catalog, connected };
  }, [mode, client]);

  const appStatus = useCallback(
    async (slug: string) => (mode === "demo" ? (SAMPLE_APPS.connected.services[slug] ?? null) : ((await client().appStatus(slug)).services[slug] ?? null)),
    [mode, client],
  );

  const connectApp = useCallback(
    async (slug: string, alias?: string) => {
      if (mode === "demo") throw new Error("Connecting apps needs a paired computer.");
      const { url } = await client().connectApp(slug, alias);
      if (!url?.startsWith("https://")) throw new Error("The computer didn't send a sign-in page.");
      return url;
    },
    [mode, client],
  );

  const registerPush = useCallback(
    async (registration: PhonePushRegistration) => {
      if (mode !== "live") throw new Error("Notifications need a paired computer.");
      return await client().registerPush(registration);
    },
    [mode, client],
  );

  const vault = useCallback(async () => (mode === "demo" ? SAMPLE_VAULT : await client().vault()), [mode, client]);

  const addToVault = useCallback(
    async (item: NewVaultItem) => {
      if (mode === "demo") throw new Error("Saving to the Vault needs a paired computer.");
      await client().addToVault(item);
    },
    [mode, client],
  );

  const removeFromVault = useCallback(
    async (kind: VaultKind, itemId: string) => {
      if (mode === "demo") throw new Error("Changing the Vault needs a paired computer.");
      await client().removeFromVault(kind, itemId);
    },
    [mode, client],
  );

  const runRoutine = useCallback(
    async (routineId: string) => {
      await client().runRoutine(routineId);
    },
    [client],
  );

  const retry = useCallback(() => live.current?.retryNow(), []);

  const upload = useCallback<Connection["upload"]>(
    async (pick) => {
      const bytes = await new File(pick.uri).bytes();
      if (bytes.byteLength > FILE_MAX_BYTES) {
        throw new Error(`${pick.name} is larger than ${limitMegabytes(FILE_MAX_BYTES)} MB.`);
      }
      const api = client();
      const uploadId = Crypto.randomUUID();
      if (pick.kind === "image") {
        const saved = await api.uploadImage(bytes, pick.mime, uploadId);
        return { kind: "image", path: saved.path, name: pick.name };
      }
      const saved = await api.uploadFile(bytes, pick.mime, pick.name, uploadId);
      return { kind: "file", path: saved.path, name: saved.name || pick.name };
    },
    [client],
  );

  const newThread = useCallback(
    async (botId: string, folderId?: string) => {
      const created = await client().newThread(botId, folderId);
      dispatch({ type: "frame", frame: { kind: "bot", bot: created.bot } });
      return created.task.threadId;
    },
    [client],
  );

  const newFolder = useCallback(
    async (botId: string, folder: { name: string; emoji?: string }) => {
      const reply = await client().newFolder(botId, folder);
      dispatch({ type: "frame", frame: { kind: "bot", bot: reply.bot } });
    },
    [client],
  );

  const setPinned = useCallback(
    async (botId: string, pinned: boolean) => {
      const reply = await client().setPinned(botId, pinned);
      dispatch({ type: "frame", frame: { kind: "bot", bot: reply.bot } });
    },
    [client],
  );

  const setModel = useCallback(
    async (botId: string, selection: { instanceId: string; model: string }) => {
      if (mode === "demo") throw new Error("Changing a bot's model needs a paired computer.");
      const reply = await client().setModel(botId, selection);
      dispatch({ type: "frame", frame: { kind: "bot", bot: reply.bot } });
    },
    [mode, client],
  );

  const markRead = useCallback(
    async (botId: string, threadId: string) => {
      const reply = await client().markRead(botId, threadId);
      dispatch({ type: "frame", frame: { kind: "bot", bot: reply.bot } });
    },
    [client],
  );

  const deleteBot = useCallback(
    async (botId: string) => {
      await client().deleteBot(botId);
      dispatch({ type: "frame", frame: { kind: "bot.deleted", botId } });
    },
    [client],
  );

  const attachmentSource = useCallback(
    (path: string) => {
      if (mode !== "live" || !session) return null;
      const base = session.urls[urlIndex.current % session.urls.length].replace(/\/+$/, "");
      return { uri: `${base}${path}`, headers: { authorization: `Bearer ${session.token}` } };
    },
    [mode, session],
  );

  const value = useMemo<Connection>(
    () => ({
      mode,
      demoAvailable: DEMO_AVAILABLE,
      link,
      problem,
      session,
      world,
      setDemo,
      pairWith,
      forget,
      retry,
      loadThread,
      send,
      stop,
      respond,
      setRoutineEnabled,
      runRoutine,
      apps,
      appStatus,
      connectApp,
      attachmentSource,
      upload,
      newThread,
      newFolder,
      setPinned,
      setModel,
      markRead,
      deleteBot,
      refreshInbox,
      markInboxRead,
      memory,
      memoryFile,
      vault,
      addToVault,
      removeFromVault,
      registerPush,
    }),
    [
      mode,
      link,
      problem,
      session,
      world,
      setDemo,
      pairWith,
      forget,
      retry,
      loadThread,
      send,
      stop,
      respond,
      setRoutineEnabled,
      runRoutine,
      apps,
      appStatus,
      connectApp,
      attachmentSource,
      upload,
      newThread,
      newFolder,
      setPinned,
      setModel,
      markRead,
      deleteBot,
      refreshInbox,
      markInboxRead,
      memory,
      memoryFile,
      vault,
      addToVault,
      removeFromVault,
      registerPush,
    ],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): Connection {
  const connection = useContext(ConnectionContext);
  if (!connection) throw new Error("useConnection outside ConnectionProvider");
  return connection;
}
