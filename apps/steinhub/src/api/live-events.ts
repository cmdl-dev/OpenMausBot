import type { ServerFrame } from "@openmausbot/phone-protocol/wire.ts";
import type { StreamFrame } from "@/api/client";
import { asDesktopError, DesktopError } from "@/api/errors";

export type LinkState = "connecting" | "online" | "offline" | "signed-out" | "update-app";

export interface LiveEventsOptions {
  open(since: string | null, onFrame: (frame: StreamFrame) => void, signal: AbortSignal): Promise<void>;
  /** The stream started without the frames before it: load everything again before applying new ones. */
  snapshot(): Promise<void>;
  onFrame(frame: ServerFrame): void;
  onState(state: LinkState, error?: DesktopError): void;
  /** An attempt failed for want of a connection: the caller may move to its next address. */
  onUnreachable?(): void;
  /** The server sends a visible frame at least this often; silence longer than this is a dead connection. */
  staleMs?: number;
  retryMinMs?: number;
  retryMaxMs?: number;
}

export interface LiveEvents {
  stop(): void;
  /** Reconnect now, resetting the backoff: the app came to the foreground, or the person pressed Try again. */
  retryNow(): void;
}

export const STALE_MS = 40_000;
export const RETRY_MIN_MS = 500;
export const RETRY_MAX_MS = 10_000;

export function startLiveEvents(options: LiveEventsOptions): LiveEvents {
  const staleMs = options.staleMs ?? STALE_MS;
  const retryMin = options.retryMinMs ?? RETRY_MIN_MS;
  const retryMax = options.retryMaxMs ?? RETRY_MAX_MS;
  let stopped = false;
  let cursor: string | null = null;
  let delay = retryMin;
  let generation = 0;
  let controller: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastHeard = Date.now();

  const watchdog = setInterval(() => {
    if (controller && Date.now() - lastHeard >= staleMs) fail(generation, new DesktopError("offline", "the event stream went quiet"));
  }, Math.max(250, Math.floor(staleMs / 4)));

  function fail(attempt: number, error: DesktopError) {
    if (stopped || attempt !== generation || !controller) return;
    controller.abort();
    controller = null;
    if (error.kind === "signed-out" || error.kind === "update-app") {
      options.onState(error.kind, error);
      return;
    }
    options.onState("offline", error);
    if (error.kind === "offline") options.onUnreachable?.();
    retryTimer = setTimeout(connect, delay);
    delay = Math.min(delay * 2, retryMax);
  }

  function connect() {
    if (stopped) return;
    retryTimer = null;
    const attempt = ++generation;
    const current = new AbortController();
    controller = current;
    lastHeard = Date.now();
    options.onState("connecting");
    let queue: StreamFrame[] | null = null;

    const ready = (helloCursor: string) => {
      cursor = helloCursor;
      delay = retryMin;
      options.onState("online");
    };

    const apply = ({ frame, cursor: next }: StreamFrame) => {
      if (next) cursor = next;
      options.onFrame(frame);
    };

    options
      .open(
        cursor,
        (incoming) => {
          if (attempt !== generation) return;
          lastHeard = Date.now();
          const { frame } = incoming;
          if (frame.kind === "hello") {
            if (frame.resumed) return ready(frame.cursor);
            queue = [];
            options.snapshot().then(
              () => {
                if (attempt !== generation) return;
                ready(frame.cursor);
                const held = queue ?? [];
                queue = null;
                held.forEach(apply);
              },
              (error: unknown) => fail(attempt, asDesktopError(error)),
            );
            return;
          }
          if (queue) queue.push(incoming);
          else apply(incoming);
        },
        current.signal,
      )
      .then(
        () => fail(attempt, new DesktopError("offline", "the event stream ended")),
        (error: unknown) => fail(attempt, asDesktopError(error)),
      );
  }

  connect();

  return {
    stop() {
      stopped = true;
      clearInterval(watchdog);
      if (retryTimer) clearTimeout(retryTimer);
      controller?.abort();
      controller = null;
    },
    retryNow() {
      if (stopped) return;
      if (retryTimer) clearTimeout(retryTimer);
      controller?.abort();
      controller = null;
      delay = retryMin;
      connect();
    },
  };
}
