import { createHash } from "node:crypto";
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";

import { notModified, sendTunnelJson } from "./tunnel-gzip.ts";

export { gzipRemoteReplies, openEventStream, type EventStreamBody, type RemoteReplies } from "./tunnel-gzip.ts";

const jsonHooks = new WeakMap<ServerResponse, (body: unknown) => unknown>();
const parsedBodies = new WeakMap<IncomingMessage, unknown>();

/** Every JSON body sent on this response passes through `hook` (it may return a narrowed copy); later hooks run after earlier ones. */
export function onJsonBody(res: ServerResponse, hook: (body: unknown) => unknown): void {
  const previous = jsonHooks.get(res);
  jsonHooks.set(res, previous ? (body) => hook(previous(body)) : hook);
}

export function parsedBodyOf(req: IncomingMessage): unknown {
  return parsedBodies.get(req);
}

const bodyChecks = new WeakMap<IncomingMessage, (body: unknown) => { status: number; error: string } | null>();

/** Every JSON body read from this request passes `check` first: a refusal fails the read with its status, so the route
 * answers it as it answers a body it cannot read. Earlier checks run first. */
export function onParsedBody(req: IncomingMessage, check: (body: unknown) => { status: number; error: string } | null): void {
  const previous = bodyChecks.get(req);
  bodyChecks.set(req, previous ? (body) => previous(body) ?? check(body) : check);
}

export function json(res: ServerResponse, status: number, body: unknown) {
  const hook = jsonHooks.get(res);
  const data = JSON.stringify(hook ? hook(body) : body);
  const headers: OutgoingHttpHeaders = { "content-type": "application/json" };
  const tag = status === 200 && res.req?.method === "GET" && typeof data === "string" ? jsonTag(data) : null;
  if (tag) {
    headers.etag = tag;
    // Always asked again, and never kept by a shared cache; a route's own cache-control stands.
    if (!res.hasHeader("cache-control")) headers["cache-control"] = "private, no-cache";
    if (revalidates(res.req.headers["if-none-match"], tag)) {
      const { "content-type": _type, ...validators } = headers;
      return notModified(res, validators, Buffer.byteLength(data));
    }
  }
  if (sendTunnelJson(res, status, headers, data)) return;
  res.writeHead(status, headers);
  res.end(data);
}

/** Weak, since the same body may go out gzipped or not. A 304 only ever says "what you hold is exactly what this request
 * would be sent now", so it reveals nothing the body would not. */
export function jsonTag(data: string): string {
  return `W/"${createHash("sha256").update(data).digest("base64url").slice(0, 27)}"`;
}

/** If-None-Match's weak comparison (RFC 9110 §13.1.2): `*`, or any listed tag with the same opaque value. */
export function revalidates(header: string | string[] | undefined, tag: string): boolean {
  if (header === undefined) return false;
  const opaque = (value: string) => value.trim().replace(/^W\//, "");
  const want = opaque(tag);
  return [header].flat().join(",").split(",").some((entry) => entry.trim() === "*" || opaque(entry) === want);
}

export function readBody(req: IncomingMessage, limit = 1_000_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let done = false;
    const fail = (status: number, msg: string) => {
      if (done) return;
      done = true;
      const err = Object.assign(new Error(msg), { status });
      reject(err);
    };
    req.on("data", (c) => {
      if (done) return;
      bytes += typeof c === "string" ? Buffer.byteLength(c) : c.length;
      if (bytes > limit) {
        // Keep draining but stop retaining attacker-controlled bytes; destroying the request would lose the 413.
        return fail(413, "body too large");
      }
      chunks.push(typeof c === "string" ? Buffer.from(c) : c);
    });
    req.on("end", () => {
      if (done) return;
      // Decode once: a character split across two chunks turns into U+FFFD when each is decoded alone.
      const data = Buffer.concat(chunks).toString("utf8");
      let body: any;
      try {
        body = data ? JSON.parse(data) : {};
      } catch {
        return fail(400, "invalid JSON body");
      }
      try {
        const refused = bodyChecks.get(req)?.(body);
        if (refused) return fail(refused.status, refused.error);
        done = true;
        parsedBodies.set(req, body);
        resolve(body);
      } catch (error) {
        done = true;
        reject(error);
      }
    });
    req.on("error", (e) => fail(400, e instanceof Error ? e.message : String(e)));
  });
}
