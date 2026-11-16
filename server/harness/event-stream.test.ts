import { createServer, request, type IncomingHttpHeaders, type RequestListener, type Server } from "node:http";
import { createGunzip } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openSseHeartbeat } from "../sse-fanout.ts";
import { gzipRemoteReplies, json, jsonTag, openEventStream, revalidates, type EventStreamBody } from "./http.ts";

const BOT = { kind: "bot", bot: { id: "b1", name: "Probe", tasks: Array.from({ length: 20 }, (_, i) => ({ threadId: `t${i}`, title: `task ${i}`, busy: false })) } };
const frame = (seq: number, busy = false) => `id: s:${seq}\ndata: ${JSON.stringify({ ...BOT, bot: { ...BOT.bot, busy }, seq })}\n\n`;

const streams: EventStreamBody[] = [];
const handler: RequestListener = (req, res) => {
  if (req.url === "/events") {
    const body = openEventStream(res, 200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    streams.push(body);
    body.write(frame(1));
    return;
  }
  if (req.url === "/state") return json(res, 200, BOT);
  if (req.url === "/small") return json(res, 200, { ok: true });
  if (req.url === "/missing") return json(res, 404, { error: "no such bot" });
  if (req.url === "/private") {
    res.setHeader("cache-control", "no-store");
    return json(res, 200, BOT);
  }
  return json(res, 200, { ok: true, method: req.method });
};

let remote: Server;
let local: Server;
let sealed: Server;
const ports = { remote: 0, local: 0, sealed: 0 };
const listen = (server: Server) =>
  new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));

beforeAll(async () => {
  remote = createServer(gzipRemoteReplies(handler));
  local = createServer(gzipRemoteReplies(handler, { when: () => false }));
  sealed = createServer(gzipRemoteReplies(handler, { sealedHop: true }));
  ports.remote = await listen(remote);
  ports.local = await listen(local);
  ports.sealed = await listen(sealed);
});

afterAll(async () => {
  for (const server of [remote, local, sealed]) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

type Stream = { headers: IncomingHttpHeaders; wire: () => number; events: () => string[]; next: (count: number) => Promise<string[]>; close: () => void };

/** An open event stream, decoded as it arrives the way a browser's EventSource sees it. */
function openStream(port: number, acceptEncoding: string): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/events", headers: { "accept-encoding": acceptEncoding } }, (res) => {
      let wire = 0;
      let text = "";
      const waiters: Array<{ count: number; done: (events: string[]) => void }> = [];
      const events = () => text.split("\n\n").filter(Boolean);
      const decoded = (chunk: Buffer) => {
        text += chunk.toString("utf8");
        for (const waiter of waiters.filter((one) => events().length >= one.count)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.done(events());
        }
      };
      const unzip = res.headers["content-encoding"] === "gzip" ? createGunzip() : null;
      unzip?.on("data", decoded);
      res.on("data", (chunk: Buffer) => { wire += chunk.length; if (unzip) unzip.write(chunk); else decoded(chunk); });
      resolve({
        headers: res.headers, wire: () => wire, events,
        next: (count) => new Promise((done) => { if (events().length >= count) done(events()); else waiters.push({ count, done }); }),
        close: () => req.destroy(),
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("openEventStream", () => {
  it("gzips a remote stream with one context, every event decodable the moment it is written", async () => {
    streams.length = 0;
    const stream = await openStream(ports.remote, "gzip, deflate, br");
    expect(stream.headers["content-encoding"]).toBe("gzip");
    expect(stream.headers.vary).toBe("Accept-Encoding");
    expect(stream.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(await stream.next(1)).toEqual([frame(1).slice(0, -2)]);
    const afterFirst = stream.wire();
    const body = streams[0]!;
    body.write(frame(2, true));
    expect((await stream.next(2))[1]).toBe(frame(2, true).slice(0, -2));
    // The second frame repeats the first nearly whole, so the shared window sends it for a few dozen bytes.
    expect(stream.wire() - afterFirst).toBeLessThan(80);
    expect(stream.wire()).toBeLessThan(Buffer.byteLength(frame(1) + frame(2, true)) / 4);
    stream.close();
  });

  it("compresses each event in a window of its own on a sealed hop, so one event's words never shape another's size", async () => {
    streams.length = 0;
    const stream = await openStream(ports.sealed, "gzip");
    expect(stream.headers["content-encoding"]).toBe("gzip");
    await stream.next(1);
    const afterFirst = stream.wire();
    streams[0]!.write(frame(2, true));
    expect((await stream.next(2))[1]).toBe(frame(2, true).slice(0, -2));
    // The repeat costs what the first frame cost alone, not the few dozen bytes a shared window gives it.
    expect(stream.wire() - afterFirst).toBeGreaterThan(afterFirst * 0.6);
    // Two events in one write, as a proxy hands on a chunk: each still has a window of its own.
    const beforePair = stream.wire();
    streams[0]!.write(frame(3) + frame(4));
    expect((await stream.next(4)).slice(2)).toEqual([frame(3).slice(0, -2), frame(4).slice(0, -2)]);
    expect(stream.wire() - beforePair).toBeGreaterThan(afterFirst * 1.6);
    stream.close();
  });

  it("writes a stream as it is for a client that does not take gzip, or on a listener that is not remote", async () => {
    const plain = await openStream(ports.remote, "identity");
    expect(plain.headers["content-encoding"]).toBeUndefined();
    // Left open to a proxy's own encoding.
    expect(plain.headers["cache-control"]).toBe("no-cache");
    expect(plain.headers.vary).toBe("Accept-Encoding");
    expect(await plain.next(1)).toEqual([frame(1).slice(0, -2)]);
    plain.close();
    const loopback = await openStream(ports.local, "gzip");
    expect(loopback.headers["content-encoding"]).toBeUndefined();
    expect(loopback.headers.vary).toBeUndefined();
    expect(await loopback.next(1)).toEqual([frame(1).slice(0, -2)]);
    loopback.close();
  });

  it("ends the gzip stream cleanly when its heartbeat closes it, and counts unsent bytes as buffered", async () => {
    streams.length = 0;
    const stream = await openStream(ports.remote, "gzip");
    await stream.next(1);
    const body = streams[0]!;
    let closed = 0;
    const close = openSseHeartbeat(body, { everyMs: 10, live: () => true, onClose: () => { closed += 1; } });
    await stream.next(3);
    expect(stream.events().slice(1, 3)).toEqual([": keepalive", `data: {"kind":"ping"}`]);
    expect(body.writableLength).toBeGreaterThanOrEqual(0);
    close();
    close();
    expect(closed).toBe(1);
    expect(body.writableEnded).toBe(true);
    stream.close();
  });
});

describe("JSON validators", () => {
  const get = (port: number, path: string, headers: Record<string, string> = {}, method = "GET") =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on("error", reject);
      req.end();
    });

  it("tags a GET's 200 and answers an unchanged body with an empty 304", async () => {
    const first = await get(ports.local, "/state");
    expect(first.status).toBe(200);
    expect(first.headers.etag).toBe(jsonTag(JSON.stringify(BOT)));
    expect(first.headers["cache-control"]).toBe("private, no-cache");
    const again = await get(ports.local, "/state", { "if-none-match": first.headers.etag! });
    expect(again.status).toBe(304);
    expect(again.body).toBe("");
    expect(again.headers).toMatchObject({ etag: first.headers.etag, "cache-control": "private, no-cache" });
    expect(again.headers.vary).toBeUndefined();
    expect(again.headers["content-type"]).toBeUndefined();
    // A proxy that weakened or listed the tag still matches; another body never does.
    expect((await get(ports.local, "/state", { "if-none-match": `"x", ${first.headers.etag!.slice(2)}` })).status).toBe(304);
    expect((await get(ports.local, "/other", { "if-none-match": first.headers.etag! })).status).toBe(200);
  });

  it("repeats a remote 200's vary on its 304, and leaves a route's own cache-control as it is", async () => {
    const first = await get(ports.remote, "/state", { "accept-encoding": "gzip" });
    expect(first.headers.vary).toBe("Accept-Encoding");
    const again = await get(ports.remote, "/state", { "accept-encoding": "gzip", "if-none-match": first.headers.etag! });
    expect(again.status).toBe(304);
    expect(again.headers.vary).toBe("Accept-Encoding");
    // A body too small to gzip goes without vary, and so does its 304.
    const small = await get(ports.remote, "/small", { "accept-encoding": "gzip" });
    expect(small.headers.vary).toBeUndefined();
    expect((await get(ports.remote, "/small", { "accept-encoding": "gzip", "if-none-match": small.headers.etag! })).headers.vary).toBeUndefined();
    const kept = await get(ports.local, "/private");
    expect(kept.headers["cache-control"]).toBe("no-store");
    expect(kept.headers.etag).toBe(first.headers.etag);
  });

  it("tags only a GET's 200", async () => {
    expect((await get(ports.local, "/missing")).headers.etag).toBeUndefined();
    const posted = await get(ports.local, "/other", { "if-none-match": "*" }, "POST");
    expect(posted.status).toBe(200);
    expect(posted.headers.etag).toBeUndefined();
  });

  it("compares tags weakly", () => {
    const tag = jsonTag("{}");
    expect(revalidates(undefined, tag)).toBe(false);
    expect(revalidates(tag, tag)).toBe(true);
    expect(revalidates(tag.slice(2), tag)).toBe(true);
    expect(revalidates(`W/"other", ${tag}`, tag)).toBe(true);
    expect(revalidates([`W/"other"`, tag], tag)).toBe(true);
    expect(revalidates("*", tag)).toBe(true);
    expect(revalidates(`W/"other"`, tag)).toBe(false);
    expect(jsonTag("{}")).toBe(tag);
    expect(jsonTag("[]")).not.toBe(tag);
  });
});
