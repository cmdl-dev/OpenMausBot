// Gzips replies that cross a network nothing else compresses: the phone tunnel (the user's home upload to Cloudflare),
// a LAN or tailnet peer, and the companion's own listeners. Cloud and VPS routes already pass Caddy's `encode` (which
// strips Accept-Encoding on its way in), and loopback would only spend CPU.
// This file is both server/harness/tunnel-gzip.ts and companion/src/tunnel-gzip.ts, since the companion builds alone;
// a test keeps the two equal.
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import { constants, createGzip, gzip } from "node:zlib";

/** Below this, the gzip framing and a zlib pass cost more than they save. */
export const GZIP_MIN_BYTES = 1024;
const JSON_TYPE = /^application\/json\s*(;|$)/i;
/** Whether an event stream's events share one compression window. */
type EventWindow = "shared" | "own";
const remoteReplies = new WeakMap<ServerResponse, EventWindow>();

export interface RemoteReplies {
  /** The requests whose replies cross a network; every one when absent. */
  when?: (req: IncomingMessage) => boolean;
  /** Security: the hop is sealed end to end through a relay that sees each record's size. Each event is then compressed in
   * a window of its own, so text one event carries (an email, a page, a teammate's line) cannot reveal another event's
   * words through how much it compresses. A TLS hop keeps one shared window, as permessage-deflate does. */
  sealedHop?: boolean;
}

/** Wraps a listener's request handler. WebSocket upgrades are a separate server event and never pass here. */
export function gzipRemoteReplies<T>(handle: (req: IncomingMessage, res: ServerResponse) => T, options: RemoteReplies = {}) {
  return (req: IncomingMessage, res: ServerResponse): T => {
    if (!options.when || options.when(req)) remoteReplies.set(res, options.sealedHop ? "own" : "shared");
    return handle(req, res);
  };
}

/** Whether Accept-Encoding takes gzip: named, or covered by `*`, with a q above 0. A named gzip outranks `*`. */
export function acceptsGzip(header: string | string[] | undefined): boolean {
  let named: number | undefined;
  let wildcard: number | undefined;
  for (const entry of [header ?? ""].flat().join(",").split(",")) {
    const [coding, ...params] = entry.split(";").map((part) => part.trim().toLowerCase());
    const q = params.find((param) => param.startsWith("q="));
    const weight = q === undefined ? 1 : Number(q.slice(2));
    if (coding === "gzip" || coding === "x-gzip") named = weight;
    else if (coding === "*") wildcard = weight;
  }
  return (named ?? wildcard ?? 0) > 0;
}

/** `vary` with Accept-Encoding added once; `*` already covers it. */
export function varyOnEncoding(vary: number | string | string[] | undefined): string {
  const names = [vary ?? ""].flat().join(",").split(",").map((name) => name.trim()).filter(Boolean);
  if (!names.some((name) => name === "*" || name.toLowerCase() === "accept-encoding")) names.push("Accept-Encoding");
  return names.join(", ");
}

/** A JSON body on a remote reply, with a body to send, that nothing has encoded yet. Local replies stop at the
 * first check, before the body is measured. */
export function gzipCandidate(res: ServerResponse, status: number, headers: OutgoingHttpHeaders, body: string): boolean {
  return remoteReplies.has(res) && res.req.method !== "HEAD" && status !== 204 && status !== 304
    && JSON_TYPE.test(String(headers["content-type"] ?? "")) && !headers["content-encoding"] && !res.hasHeader("content-encoding")
    // JSON.stringify(undefined) is undefined, whatever its type says.
    && typeof body === "string" && Buffer.byteLength(body) >= GZIP_MIN_BYTES;
}

/** Sends a whole JSON `body` (headers carry no Content-Length), gzipped when the client takes gzip. False means it is
 * not a candidate and nothing was sent: the caller replies exactly as it did before. */
export function sendTunnelJson(res: ServerResponse, status: number, headers: OutgoingHttpHeaders, body: string): boolean {
  if (!gzipCandidate(res, status, headers, body)) return false;
  const vary = varyOnEncoding(headers.vary ?? res.getHeader("vary"));
  if (!acceptsGzip(res.req.headers["accept-encoding"])) {
    res.writeHead(status, { ...headers, vary, "content-length": Buffer.byteLength(body) }).end(body);
    return true;
  }
  // Headers now, so the reply counts as answered at once; the body once zlib, off the event loop, is done.
  // Ending a response whose client already left is a no-op.
  res.writeHead(status, { ...headers, vary, "content-encoding": "gzip" });
  gzip(body, (error, zipped) => (error ? res.destroy() : res.end(zipped)));
  return true;
}

/** What an event stream writes to: the response itself, or a gzip stream in front of it. */
export interface EventStreamBody {
  write(chunk: string): boolean;
  end(): void;
  readonly writableLength: number;
  readonly writableEnded: boolean;
  readonly destroyed: boolean;
  once(event: "drain", listener: () => void): unknown;
  on(event: "drain" | "error", listener: (...args: any[]) => void): unknown;
}

/** Starts an event stream. A remote reply to a client that takes gzip goes through one gzip stream, flushed after every
 * write so each event reaches the client whole and at once. In a shared window an event that repeats much of an earlier
 * one (a bot's state, a growing message) costs a few bytes. Anything else is written as it is. */
export function openEventStream(res: ServerResponse, status: number, headers: OutgoingHttpHeaders): EventStreamBody {
  if (!remoteReplies.has(res)) {
    res.writeHead(status, headers);
    return res;
  }
  const vary = varyOnEncoding(headers.vary ?? res.getHeader("vary"));
  if (!acceptsGzip(res.req.headers["accept-encoding"])) {
    res.writeHead(status, { ...headers, vary });
    return res;
  }
  // A proxy that takes the stream apart to encode it again would hold events back; only a stream sent as it is stays
  // open to a proxy's own encoding (Caddy's `encode` skips a no-transform reply).
  const given = String(headers["cache-control"] ?? "");
  const cacheControl = /(^|,)\s*no-transform\s*(,|$)/i.test(given) ? given : [given, "no-transform"].filter(Boolean).join(", ");
  res.writeHead(status, { ...headers, vary, "cache-control": cacheControl, "content-encoding": "gzip" });
  const ownWindows = remoteReplies.get(res) === "own";
  const zip = createGzip({ flush: ownWindows ? constants.Z_FULL_FLUSH : constants.Z_SYNC_FLUSH });
  zip.pipe(res);
  zip.on("error", () => res.destroy());
  res.on("close", () => zip.destroy());
  return {
    write: (chunk) => (ownWindows ? eventsIn(chunk) : [chunk]).reduce((open, event) => zip.write(event) && open, true),
    end: () => zip.end(),
    // Bytes not yet compressed count too: a client that stops reading backs them up here first.
    get writableLength() { return zip.writableLength + zip.readableLength + res.writableLength; },
    get writableEnded() { return zip.writableEnded || res.writableEnded; },
    get destroyed() { return zip.destroyed || res.destroyed; },
    once: (event, listener) => zip.once(event, listener),
    on: (event, listener) => (event === "error" ? res : zip).on(event, listener),
  };
}

/** `text` cut after each event's blank line; a trailing partial event is a piece of its own. */
function eventsIn(text: string): string[] {
  return text.match(/[^]*?\n\n|[^]+$/g) ?? [];
}

/** The empty 304 for a `bytes`-long body the client already holds: the validators, and `vary` as the 200 had it. */
export function notModified(res: ServerResponse, headers: OutgoingHttpHeaders, bytes: number): void {
  const vary = remoteReplies.has(res) && bytes >= GZIP_MIN_BYTES ? { vary: varyOnEncoding(res.getHeader("vary")) } : {};
  res.writeHead(304, { ...headers, ...vary });
  res.end();
}
