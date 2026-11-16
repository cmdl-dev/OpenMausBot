// What a paired device may ask for: everything, once it is paired.

export interface Denial {
  status: number;
  error: string;
}

export interface RouteRequest {
  path: string;
  method: string;
  authenticated: boolean;
}

/** A POST whose response is file bytes: a `.json` document must not go through
 * the JSON scrub and come back as different bytes. */
export const MESSAGE_FILE_ROUTE = {
  method: "POST",
  path: /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/file$/,
} as const;

/** The live view of a bot's browser, which stays signed in to the person's real accounts. */
export const BROWSER_LIVE_ROUTE = {
  method: "GET",
  path: /^\/api\/bots\/[\w-]+\/browser\/live$/,
} as const;

export const BROWSER_ACTION_ROUTE = {
  method: "POST",
  path: /^\/api\/bots\/[\w-]+\/browser\/action$/,
} as const;

export function isMessageFileDownload(method: string, path: string): boolean {
  return method === MESSAGE_FILE_ROUTE.method && MESSAGE_FILE_ROUTE.path.test(path);
}

/** Whether a response may show a signed-in browser, so the relay re-checks the device before releasing it. */
export function isBrowserControlAccess(method: string, path: string): boolean {
  return (method === BROWSER_LIVE_ROUTE.method && BROWSER_LIVE_ROUTE.path.test(path))
    || (method === BROWSER_ACTION_ROUTE.method && BROWSER_ACTION_ROUTE.path.test(path));
}

/** Sent by the companion itself, never a device: a phone is refused them, and the harness accepts them only with the
 * relay token or from loopback. `device-revoked` ends the Live call an unpaired phone holds. */
const COMPANION_NOTICES: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: "POST", path: /^\/api\/live\/device-revoked$/ },
];

export function isCompanionNotice(method: string, path: string): boolean {
  return COMPANION_NOTICES.some((route) => route.method === method && route.path.test(path));
}

/** A paired device is an extension of the app on the computer: once it holds a credential, every route the app has is
 * open to it. Only pairing and liveness are open before that. */
export function denyReason({ path, method, authenticated }: RouteRequest): Denial | null {
  if (method === "POST" && path === "/api/pair") return null;
  if (method === "GET" && path === "/api/health") return null;
  if (!authenticated) {
    return { status: 401, error: "pair this device from Remote access settings on the host computer" };
  }
  if (isCompanionNotice(method, path)) return { status: 404, error: `no route: ${method} ${path}` };
  return null;
}
