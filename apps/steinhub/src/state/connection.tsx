import * as Crypto from "expo-crypto";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { desktopClient, type DesktopClient } from "@/api/client";
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
  /** A new conversation with the bot, in a folder when given. Resolves to its thread. */
  newThread(botId: string, folderId?: string): Promise<string>;
  newFolder(botId: string, folder: { name: string; emoji?: string }): Promise<void>;
  setPinned(botId: string, pinned: boolean): Promise<void>;
  markRead(botId: string, threadId: string): Promise<void>;
  deleteBot(botId: string): Promise<void>;
  /** An `/api/attachments/…` path as an image source on the paired computer, with this device's token. */
  attachmentSource(path: string): { uri: string; headers: Record<string, string> } | null;
  runRoutine(routineId: string): Promise<void>;
}

const ConnectionContext = createContext<Connection | null>(null);

const DEMO_AVAILABLE = __DEV__;
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
    const [bots, instances, routines, host] = await Promise.all([
      api.bots(),
      api.instances().catch(() => null),
      api.routines().catch(() => null),
      api.endpoints().catch(() => null),
    ]);
    dispatch({ type: "bots", reply: bots });
    if (instances) dispatch({ type: "instances", reply: instances });
    if (routines) dispatch({ type: "routines", reply: routines });
    if (host) dispatch({ type: "host", snapshot: host });
    await Promise.all(
      [...loadedThreads.current].map((threadId) =>
        api.messages(threadId, { limit: PAGE_SIZE }).then(
          (page) => dispatch({ type: "page", threadId, page }),
          () => undefined,
        ),
      ),
    );
  }, [client]);

  useEffect(() => {
    if (mode !== "live" || !session) return;
    const events = startLiveEvents({
      open: (since, onFrame, signal) => client().events(since, onFrame, signal),
      snapshot,
      onFrame: (frame) => {
        dispatch({ type: "frame", frame });
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
  }, [mode, session, client, snapshot]);

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
    },
    [client],
  );

  const setRoutineEnabled = useCallback(
    async (routineId: string, enabled: boolean) => {
      const reply = await client().setRoutineEnabled(routineId, enabled);
      if (reply?.routine) dispatch({ type: "routine", routine: reply.routine });
    },
    [client],
  );

  const runRoutine = useCallback(
    async (routineId: string) => {
      await client().runRoutine(routineId);
    },
    [client],
  );

  const retry = useCallback(() => live.current?.retryNow(), []);

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
      attachmentSource,
      newThread,
      newFolder,
      setPinned,
      markRead,
      deleteBot,
    }),
    [mode, link, problem, session, world, setDemo, pairWith, forget, retry, loadThread, send, stop, respond, setRoutineEnabled, runRoutine, attachmentSource, newThread, newFolder, setPinned, markRead, deleteBot],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): Connection {
  const connection = useContext(ConnectionContext);
  if (!connection) throw new Error("useConnection outside ConnectionProvider");
  return connection;
}
