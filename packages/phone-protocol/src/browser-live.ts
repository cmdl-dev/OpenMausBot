/**
 * The v1 live view of a bot's browser, as a phone speaks it: GET /api/bots/:id/browser/live?threadId=&width=&height=
 * streams these events as server-sent events (the SSE `event:` line names the type, `data:` holds the rest), and
 * POST /api/bots/:id/browser/action?threadId= takes one action, always with the `viewerId` the `ready` event gave.
 * The contract is frozen: server/browser/viewers/live-v1.ts and protocol.ts serve exactly this.
 */

/** Where a frame's pixels sit on the page, in CSS pixels of the page. */
export interface BrowserFrameMetadata {
  deviceWidth: number;
  deviceHeight: number;
  offsetTop: number;
  pageScaleFactor: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
  timestamp: number;
}

export interface BrowserLiveTab {
  tabId: string;
  title: string;
  url: string;
  active: boolean;
}

export type BrowserLiveEvent =
  | { type: "ready"; viewerId: string }
  /** One JPEG at a time: the next comes only after an `ack` of this `seq`. A frame left unacknowledged for 20 s closes the view. */
  | { type: "frame"; seq: number; data: string; format: "jpeg"; metadata: BrowserFrameMetadata }
  /** `held`: someone holds the browser; `owned`: this person does, from any of their views; `controlling`: from this one. */
  | { type: "control"; held: boolean; owned: boolean; controlling: boolean }
  | { type: "tabs"; tabs: BrowserLiveTab[] }
  | { type: "url"; url: string }
  | { type: "status"; connected: boolean; screencasting: boolean; viewportWidth: number; viewportHeight: number }
  /** The browser can't show the view yet (it is starting, or busy); it keeps waiting. */
  | { type: "waiting"; reason: string }
  | { type: "heartbeat" }
  /** `asleep`: the browser closed unused, and only a new view opens it again. */
  | { type: "error"; retryable: boolean; message: string; asleep?: boolean };

/** Mouse buttons and keys as Chrome DevTools names them; `x` and `y` are CSS pixels of the page's viewport. */
export type BrowserLiveInput =
  | {
      type: "input_mouse";
      eventType: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel";
      x: number;
      y: number;
      button?: "none" | "left" | "middle" | "right";
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
    }
  | { type: "input_keyboard"; eventType: "char"; text: string }
  | { type: "input_keyboard"; eventType: "keyDown" | "keyUp"; key: string; code?: string; windowsVirtualKeyCode?: number; text?: string };

export type BrowserLiveAction =
  | { type: "take" | "release" | "back" | "forward" | "reload" }
  | { type: "ack"; seq: number }
  | { type: "navigate"; url: string }
  | BrowserLiveInput;
