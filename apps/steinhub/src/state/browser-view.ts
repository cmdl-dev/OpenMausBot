import type { BrowserLiveAction, BrowserLiveEvent } from "@openmausbot/phone-protocol/browser-live.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { asDesktopError, problemText } from "@/api/errors";
import type { BrowserLink } from "@/state/connection";

export interface BrowserControl {
  /** Someone holds the browser: a person, from any device. */
  held: boolean;
  /** This person holds it. */
  owned: boolean;
  /** This person holds it from this phone, so its taps and typing reach the page. */
  controlling: boolean;
}

export interface Size {
  width: number;
  height: number;
}

export interface BrowserViewState {
  phase: "connecting" | "waiting" | "showing" | "ended";
  /** The newest picture of the page, and the page's size in CSS pixels. */
  frame: { uri: string; page: Size } | null;
  control: BrowserControl | null;
  url: string;
  problem: string | null;
  /** The view ended for good: the browser went to sleep, and only opening it again wakes it. */
  asleep: boolean;
}

export const BROWSER_START: BrowserViewState = { phase: "connecting", frame: null, control: null, url: "", problem: null, asleep: false };

export function browserReducer(state: BrowserViewState, event: BrowserLiveEvent): BrowserViewState {
  switch (event.type) {
    case "ready":
      return { ...state, phase: "showing", problem: null };
    case "waiting":
      return state.phase === "showing" ? state : { ...state, phase: "waiting" };
    case "frame":
      return {
        ...state,
        phase: "showing",
        frame: { uri: `data:image/jpeg;base64,${event.data}`, page: { width: event.metadata.deviceWidth, height: event.metadata.deviceHeight } },
      };
    case "control":
      return { ...state, control: { held: event.held, owned: event.owned, controlling: event.controlling } };
    case "url":
      return { ...state, url: event.url };
    case "error":
      return { ...state, phase: "ended", problem: event.message, asleep: event.asleep === true, control: null };
    default:
      return state;
  }
}

/** Where the person is zoomed in on the page: `scale` about the drawing's centre, then moved by `x`, `y` points. */
export interface Zoom {
  scale: number;
  x: number;
  y: number;
}

export const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };

/** `from` zoomed to `scale` keeping the page under `focal` (points from the drawing's centre) where it is on screen. */
export function zoomAt(from: Zoom, scale: number, focal: { x: number; y: number }): Zoom {
  const grow = scale / from.scale;
  return { scale, x: focal.x - (focal.x - from.x) * grow, y: focal.y - (focal.y - from.y) * grow };
}

/** The page point, in CSS pixels, under a touch at `touch` on a page drawn `drawn` points large and zoomed by `zoom`. */
export function pagePoint(touch: { x: number; y: number }, drawn: Size, page: Size, zoom: Zoom): { x: number; y: number } {
  const local = {
    x: drawn.width / 2 + (touch.x - drawn.width / 2 - zoom.x) / zoom.scale,
    y: drawn.height / 2 + (touch.y - drawn.height / 2 - zoom.y) / zoom.scale,
  };
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), Math.max(max - 1, 0));
  return {
    x: Math.round(clamp((local.x * page.width) / drawn.width, page.width)),
    y: Math.round(clamp((local.y * page.height) / drawn.height, page.height)),
  };
}

/** The browser routes answer a refusal with a sentence of their own (who has the browser, why it can't start). */
const SAYS_WHY = new Set([400, 409, 429, 503]);

export function browserProblem(error: unknown, hostName: string): string {
  const problem = asDesktopError(error);
  return problem.status && SAYS_WHY.has(problem.status) && problem.message ? problem.message : problemText(error, hostName);
}

/** A blank tab, which a sign-in fills with the site to sign in to. */
export function blankPage(url: string): boolean {
  return !url || url === "about:blank";
}

/**
 * Streams a bot's browser while the screen is open, acknowledging each picture so the next one comes.
 * `act` sends one action after the ones before it; it resolves false, with the reason in `problem`, when the computer refuses it.
 */
export function useBrowserView(link: BrowserLink | null, hostName: string) {
  const [state, setState] = useState<BrowserViewState>(BROWSER_START);
  const [attempt, setAttempt] = useState(0);
  const viewer = useRef<string | null>(null);

  useEffect(() => {
    if (!link) return;
    const controller = new AbortController();
    viewer.current = null;
    setState(BROWSER_START);
    const onEvent = (event: BrowserLiveEvent) => {
      if (controller.signal.aborted) return;
      if (event.type === "ready") viewer.current = event.viewerId;
      setState((current) => browserReducer(current, event));
      if (event.type === "frame" && viewer.current) void link.act(viewer.current, { type: "ack", seq: event.seq }).catch(() => undefined);
    };
    link
      .open(onEvent, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setState((current) => (current.phase === "ended" ? current : { ...current, phase: "ended", control: null }));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((current) => ({ ...current, phase: "ended", control: null, problem: browserProblem(error, hostName) }));
      });
    return () => {
      controller.abort();
      viewer.current = null;
    };
  }, [link, attempt, hostName]);

  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const act = useCallback(
    (action: BrowserLiveAction): Promise<boolean> => {
      const sent = queue.current.then(async () => {
        const id = viewer.current;
        if (!link || !id) return false;
        try {
          await link.act(id, action);
          return true;
        } catch (error) {
          setState((current) => ({ ...current, problem: browserProblem(error, hostName) }));
          return false;
        }
      });
      queue.current = sent;
      return sent;
    },
    [link, hostName],
  );

  const reconnect = useCallback(() => setAttempt((value) => value + 1), []);
  const dismissProblem = useCallback(() => setState((current) => (current.phase === "ended" ? current : { ...current, problem: null })), []);

  return { state, act, reconnect, dismissProblem };
}
