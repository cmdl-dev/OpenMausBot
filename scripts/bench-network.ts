#!/usr/bin/env -S node --experimental-strip-types
// Measures what a remote browser is sent: a client paired on the tailnet (a stand-in address, as in
// server/network-payload.e2e.test.ts) loads the app, watches six fake-engine turns live, then reads again what a
// focus or a config frame asks for again. It reports bytes on the wire (status line, headers and the body as sent),
// frames and bot frames. Run it on two checkouts to compare them; the fixture is the isolated verification server.
//   node --experimental-strip-types scripts/bench-network.ts [--checkout PATH] [--out FILE]
import { request, type IncomingHttpHeaders } from "node:http";
import { networkInterfaces } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createGunzip } from "node:zlib";

const { values } = parseArgs({ options: { checkout: { type: "string", default: fileURLToPath(new URL("..", import.meta.url)) }, out: { type: "string" } } });
const { launchVerificationServer, runControlOmb } = await import(join(values.checkout, "scripts/control-omb.ts"));
const NAME = "fixture.tail1234.ts.net";
const standIn = Object.values(networkInterfaces()).flat().find((e) => e?.family === "IPv4" && !e.internal && !e.address.startsWith("169.254."))!.address;
const BROWSER = { "accept-encoding": "gzip, deflate, br" };

/** Bytes as they crossed the wire: status line, headers and the (possibly compressed) body. */
const headBytes = (status: number, raw: string[]) => `HTTP/1.1 ${status} X\r\n`.length + raw.reduce((n, v) => n + v.length + 2, 0) + 2;

function get(host: string, port: number, path: string, headers: Record<string, string>) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; wire: number; body: number }>((resolve, reject) => {
    const call = request({ host, port, path, headers }, (res) => {
      let body = 0;
      res.on("data", (c: Buffer) => { body += c.length; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body, wire: headBytes(res.statusCode ?? 0, res.rawHeaders) + body }));
    });
    call.on("error", reject);
    call.end();
  });
}

function stream(host: string, port: number, headers: Record<string, string>) {
  return new Promise<{ wire: () => number; decoded: () => string; stop: () => void }>((resolve, reject) => {
    const call = request({ host, port, path: "/api/events?window=1", headers }, (res) => {
      let wire = headBytes(res.statusCode ?? 0, res.rawHeaders);
      let text = "";
      const unzip = res.headers["content-encoding"] === "gzip" ? createGunzip() : null;
      unzip?.on("data", (c: Buffer) => { text += c.toString("utf8"); });
      res.on("data", (c: Buffer) => { wire += c.length; if (unzip) unzip.write(c); else text += c.toString("utf8"); });
      resolve({ wire: () => wire, decoded: () => text, stop: () => call.destroy() });
    });
    call.on("error", reject);
    call.end();
  });
}

const frames = (text: string) => text.split("\n\n").flatMap((b) => b.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)) as { kind: string }))
  .filter((f) => f.kind !== "ping" && f.kind !== "hello");

const fixture = await launchVerificationServer({ OMB_DEV_TRUST_LOCAL_BROWSER: "0", OMB_TAILNET_NAME: NAME, OMB_TAILNET_ADDRESSES: standIn, OMB_TEST_TAILNET_STAND_IN: standIn });
try {
  const port = Number(new URL(fixture.info.url).port);
  const host = `${NAME}:${port}`;
  const cli = (...args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
  for (let i = 0; i < 50; i++) {
    if ((await get(standIn, port, "/.well-known/openmausbot/environment", { host }).catch(() => ({ status: 0 }))).status === 200) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const offer = await (await fetch(`${fixture.info.url}/api/auth/pairing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scopes: ["client"] }) })).json() as { code: string };
  const pairedBody = await new Promise<string>((resolve, reject) => {
    const call = request({ host: standIn, port, path: "/api/auth/pair", method: "POST", headers: { host, "content-type": "application/json" } }, (res) => {
      let t = ""; res.setEncoding("utf8"); res.on("data", (c) => { t += c; }); res.on("end", () => resolve(t));
    });
    call.on("error", reject); call.end(JSON.stringify({ code: offer.code, label: "Laptop" }));
  });
  const auth = { host, authorization: `Bearer ${(JSON.parse(pairedBody) as { token: string }).token}`, ...BROWSER };

  const bots: string[] = [];
  for (const name of ["Atlas", "Birch", "Cedar"]) bots.push((await cli("new-bot", "--name", name)).bot.id);
  const turn = async (bot: string, text: string) => {
    await cli("send", "--bot", bot, "--text", text);
    await cli("wait", "--bot", bot, "--timeout", "30");
  };
  for (const bot of bots) for (let i = 1; i <= 3; i++) await turn(bot, `history line ${i}: tell me about the network layer`);

  const READS = ["/api/bots?messages=200", "/api/config", "/api/instances", "/api/notifications", `/api/routines?since=${Date.now() - 7 * 86_400_000}`, "/api/webhooks"];
  const firstLoad: Record<string, number> = {};
  const tags: Record<string, string | undefined> = {};
  for (const path of READS) {
    const reply = await get(standIn, port, path, auth);
    firstLoad[path.split("?")[0]!] = reply.wire;
    tags[path] = reply.headers.etag as string | undefined;
  }

  const remote = await stream(standIn, port, auth);
  const local = await stream("127.0.0.1", port, BROWSER);
  for (const bot of bots) for (let i = 1; i <= 2; i++) await turn(bot, `live line ${i}: compare the payloads`);
  await new Promise((r) => setTimeout(r, 1500));
  const remoteFrames = frames(remote.decoded());
  const localFrames = frames(local.decoded());
  remote.stop(); local.stop();

  const again: Record<string, number> = {};
  for (const path of ["/api/instances", "/api/config", "/api/notifications"]) {
    const reply = await get(standIn, port, path, { ...auth, ...(tags[path] ? { "if-none-match": tags[path]! } : {}) });
    again[path] = reply.wire;
  }

  const result = {
    firstLoad, firstLoadTotal: Object.values(firstLoad).reduce((a, b) => a + b, 0),
    live: { remoteWire: remote.wire(), localWire: local.wire(), frames: remoteFrames.length, botFrames: remoteFrames.filter((f) => f.kind === "bot").length, localFrames: localFrames.length },
    again, againTotal: Object.values(again).reduce((a, b) => a + b, 0),
  };
  if (values.out) writeFileSync(values.out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await fixture.close();
}
