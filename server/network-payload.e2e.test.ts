// A real server with a tailnet share: one of the runner's own non-loopback addresses stands in for the tailnet address
// (CI has no Tailscale), as in tailnet-listener.e2e.test.ts. A paired remote client and the loopback owner watch the
// same turns; the remote one is sent the same events gzipped, and a repeated read costs an empty 304.
import { request, type IncomingHttpHeaders } from "node:http";
import { networkInterfaces } from "node:os";
import { createGunzip } from "node:zlib";
import { describe, expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

const NAME = "fixture.tail1234.ts.net";
const standIn = Object.values(networkInterfaces()).flat().find((entry) => entry?.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254."))?.address;

type Frame = Record<string, unknown>;
type Watch = { headers: IncomingHttpHeaders; wire: () => number; hello: () => Frame | undefined; frames: () => Frame[]; stop: () => void };

/** Reads `/api/events` as EventSource would: decoded, split into frames, pings left out. */
function watch(options: { host: string; port: number; headers: Record<string, string> }): Promise<Watch> {
  return new Promise((resolve, reject) => {
    const call = request({ host: options.host, port: options.port, path: "/api/events?window=1", headers: options.headers }, (res) => {
      let wire = 0;
      let text = "";
      const unzip = res.headers["content-encoding"] === "gzip" ? createGunzip() : null;
      unzip?.on("data", (chunk: Buffer) => { text += chunk.toString("utf8"); });
      res.on("data", (chunk: Buffer) => { wire += chunk.length; if (unzip) unzip.write(chunk); else text += chunk.toString("utf8"); });
      const all = () => text.split("\n\n").flatMap((block) => block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)) as Frame));
      const frames = () => all().filter((frame) => frame.kind !== "ping" && frame.kind !== "hello");
      resolve({ headers: res.headers, wire: () => wire, hello: () => all().find((frame) => frame.kind === "hello"), frames, stop: () => call.destroy() });
    });
    call.on("error", reject);
    call.end();
  });
}

function dial(port: number, path: string, headers: Record<string, string>, method = "GET", body?: string) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const call = request({ host: standIn!, port, path, method, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
    });
    call.on("error", reject);
    call.end(body);
  });
}

describe.skipIf(!standIn)("what a remote client is sent", () => {
  it("gets the loopback stream's frames gzipped, resumes through Last-Event-ID, and gets an empty 304 for a read it holds", async () => {
    const fixture = await launchVerificationServer({ OMB_DEV_TRUST_LOCAL_BROWSER: "0", OMB_TAILNET_NAME: NAME, OMB_TAILNET_ADDRESSES: standIn!, OMB_TEST_TAILNET_STAND_IN: standIn! });
    const port = Number(new URL(fixture.info.url).port);
    const host = `${NAME}:${port}`;
    const cli = (...args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
    let remote: Watch | null = null;
    let resumed: Watch | null = null;
    let local: Watch | null = null;
    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        if ((await dial(port, "/.well-known/openmausbot/environment", { host }).catch(() => ({ status: 0 }))).status === 200) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const offer = await (await fetch(`${fixture.info.url}/api/auth/pairing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scopes: ["client"] }) })).json() as { code: string };
      const paired = await dial(port, "/api/auth/pair", { host, "content-type": "application/json" }, "POST", JSON.stringify({ code: offer.code, label: "Phone" }));
      const { token } = JSON.parse(paired.body) as { token: string };
      const auth = { host, authorization: `Bearer ${token}` };

      const { bot } = await cli("new-bot", "--name", "Payload");
      remote = await watch({ host: standIn!, port, headers: { ...auth, "accept-encoding": "gzip, deflate, br" } });
      local = await watch({ host: "127.0.0.1", port, headers: { "accept-encoding": "gzip" } });
      expect(remote.headers["content-encoding"]).toBe("gzip");
      expect(local.headers["content-encoding"]).toBeUndefined();

      for (const text of ["first look at payloads", "second look at payloads", "third look at payloads"]) {
        await cli("send", "--bot", bot.id, "--text", text);
        expect((await cli("wait", "--bot", bot.id, "--timeout", "30")).status).toBe("settled");
      }
      await expect.poll(() => remote!.frames().filter((frame) => frame.kind === "notify").length, { timeout: 10_000 }).toBe(3);
      await expect.poll(() => remote!.frames().length, { timeout: 5_000 }).toBe(local.frames().length);

      // The same frames reach both, in the same order; the remote wire carries a fraction of the bytes.
      expect(remote.frames()).toEqual(local.frames());
      expect(remote.wire()).toBeLessThan(local.wire() / 4);
      // No bot frame repeats the state the one before it for that bot already sent.
      const lastState = new Map<string, string>();
      for (const frame of local.frames()) {
        if (frame.kind !== "bot") continue;
        const { seq: _seq, ...state } = frame;
        const id = (frame.bot as { id: string }).id;
        expect(JSON.stringify(state)).not.toBe(lastState.get(id));
        lastState.set(id, JSON.stringify(state));
      }

      // Dropped and back with the last id it read: the missed turn is replayed into a fresh gzip stream, and the bot ends
      // in the state the loopback stream ends in.
      const lastSeq = Math.max(...remote.frames().map((frame) => Number(frame.seq)));
      const streamId = String(remote.hello()!.cursor).split(":")[0];
      remote.stop();
      await cli("send", "--bot", bot.id, "--text", "fourth look at payloads, while the phone is away");
      expect((await cli("wait", "--bot", bot.id, "--timeout", "30")).status).toBe("settled");
      await expect.poll(() => local!.frames().filter((frame) => frame.kind === "notify").length, { timeout: 10_000 }).toBe(4);
      resumed = await watch({ host: standIn!, port, headers: { ...auth, "accept-encoding": "gzip", "last-event-id": `${streamId}:${lastSeq}` } });
      expect(resumed.headers["content-encoding"]).toBe("gzip");
      await expect.poll(() => resumed!.frames().filter((frame) => frame.kind === "notify").length, { timeout: 10_000 }).toBe(1);
      expect(resumed.hello()).toMatchObject({ resumed: true });
      const missed = local.frames().filter((frame) => Number(frame.seq) > lastSeq);
      const notBot = (frames: Frame[]) => frames.filter((frame) => frame.kind !== "bot");
      expect(notBot(resumed.frames())).toEqual(notBot(missed));
      const lastBot = (frames: Frame[]) => frames.filter((frame) => frame.kind === "bot").at(-1)?.bot;
      expect(lastBot(resumed.frames())).toEqual(lastBot(local.frames()));

      const first = await dial(port, "/api/bots?messages=200", { ...auth, "accept-encoding": "gzip" });
      expect(first.status).toBe(200);
      expect(first.headers["content-encoding"]).toBe("gzip");
      const again = await dial(port, "/api/bots?messages=200", { ...auth, "accept-encoding": "gzip", "if-none-match": String(first.headers.etag) });
      expect(again.status).toBe(304);
      expect(again.body).toBe("");
    } finally {
      remote?.stop();
      resumed?.stop();
      local?.stop();
      await fixture.close();
    }
  }, 120_000);
});
