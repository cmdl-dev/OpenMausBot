import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Http2Server, type IncomingHttpHeaders } from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  APNS_DIRECT_FILE,
  APNS_TOKEN_WINDOW_MS,
  ApnsDirect,
  apnsProviderToken,
  directApnsPayload,
  inQuietHours,
  readApnsDirectConfig,
} from "./apns-direct.ts";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const CONFIG = { keyId: "ABCDE12345", teamId: "TEAM123456", bundleId: "com.example.steinhub", privateKey: PEM };
const TOKEN = "ab".repeat(32);
const PUSH = { kind: "alert", title: "Scout flagged something for you", botId: "b1", botName: "Scout", threadId: "t1", messageId: "m9", body: "Lease renewal due Friday" };

let dataDir: string;
let servers: Http2Server[];
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "omb-apns-direct-"));
  servers = [];
});
afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise((done) => server.close(done))));
  rmSync(dataDir, { recursive: true, force: true });
});

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

/** A stand-in for api.push.apple.com over plain HTTP/2: answers in turn, and records what it was sent. */
async function fakeApple(answers: Array<{ status: number; reason?: string }>) {
  const seen: Array<{ headers: IncomingHttpHeaders; body: unknown }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      const answer = answers.shift() ?? { status: 200 };
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(answer.reason ? JSON.stringify({ reason: answer.reason }) : "");
    });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { seen, origins: { production: origin, sandbox: origin } };
}

describe("the owner's own APNs key", () => {
  it("reads from apns-direct.json or the four OMB_APNS_* variables, and refuses a malformed one", () => {
    expect(readApnsDirectConfig(dataDir, {})).toBeNull();
    writeFileSync(join(dataDir, APNS_DIRECT_FILE), JSON.stringify(CONFIG), { mode: 0o600 });
    expect(readApnsDirectConfig(dataDir, {})).toEqual({ ...CONFIG, privateKey: PEM.trim() });
    writeFileSync(join(dataDir, APNS_DIRECT_FILE), JSON.stringify({ ...CONFIG, keyId: "short" }));
    expect(readApnsDirectConfig(dataDir, {})).toBeNull();
    const keyFile = join(dataDir, "AuthKey.p8");
    writeFileSync(keyFile, PEM);
    expect(readApnsDirectConfig(dataDir, { OMB_APNS_KEY_ID: CONFIG.keyId, OMB_APNS_TEAM_ID: CONFIG.teamId, OMB_APNS_BUNDLE_ID: CONFIG.bundleId, OMB_APNS_KEY_FILE: keyFile }))
      .toEqual({ ...CONFIG, privateKey: PEM.trim() });
  });

  it("signs an ES256 provider token Apple can verify, issued at the start of its window", () => {
    const now = 7 * APNS_TOKEN_WINDOW_MS + 12_345;
    const [header, claims, signature] = apnsProviderToken(CONFIG, privateKey, now).split(".");
    expect(decode(header!)).toEqual({ alg: "ES256", kid: CONFIG.keyId });
    expect(decode(claims!)).toEqual({ iss: CONFIG.teamId, iat: (7 * APNS_TOKEN_WINDOW_MS) / 1_000 });
    const valid = verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature!, "base64url"));
    expect(valid).toBe(true);
  });

  it("knows quiet hours on the phone's own clock, across midnight too", () => {
    const at = (iso: string) => Date.parse(iso);
    const night = { start: "22:00", end: "07:00", timeZone: "America/Los_Angeles" };
    expect(inQuietHours(night, at("2026-11-17T07:30:00Z"))).toBe(true);
    expect(inQuietHours(night, at("2026-11-17T15:30:00Z"))).toBe(false);
    expect(inQuietHours(night, at("2026-11-18T06:00:00Z"))).toBe(true);
    expect(inQuietHours({ start: "13:00", end: "14:00", timeZone: "UTC" }, at("2026-11-17T13:59:00Z"))).toBe(true);
    expect(inQuietHours({ start: "13:00", end: "14:00", timeZone: "UTC" }, at("2026-11-17T14:00:00Z"))).toBe(false);
    expect(inQuietHours({ start: "09:00", end: "09:00", timeZone: "UTC" }, at("2026-11-17T09:00:00Z"))).toBe(false);
    expect(inQuietHours({ start: "22:00", end: "07:00", timeZone: "Not/AZone" }, at("2026-11-17T23:00:00Z"))).toBe(false);
    expect(inQuietHours(undefined, Date.now())).toBe(false);
  });

  it("builds the payload the phone reads, silent inside quiet hours", () => {
    const loud = directApnsPayload(PUSH, { pairing: "pair-abcdef", quiet: false });
    expect(loud).toEqual({
      aps: { alert: { title: PUSH.title, body: PUSH.body }, sound: "default", "thread-id": "t1", "interruption-level": "active" },
      omb: { v: 1, kind: "alert", botId: "b1", threadId: "t1", messageId: "m9", pairing: "pair-abcdef" },
      body: { v: 1, kind: "alert", botId: "b1", threadId: "t1", messageId: "m9", pairing: "pair-abcdef" },
    });
    const quiet = directApnsPayload({ ...PUSH, body: undefined, messageId: undefined }, { quiet: true });
    expect(quiet.aps).toEqual({ alert: { title: PUSH.title }, "thread-id": "t1", "interruption-level": "passive" });
    expect(quiet.omb).toEqual({ v: 1, kind: "alert", botId: "b1", threadId: "t1" });
  });

  it("sends to Apple with the topic, the token in the path and a fresh provider token after Apple refuses one", async () => {
    writeFileSync(join(dataDir, APNS_DIRECT_FILE), JSON.stringify(CONFIG), { mode: 0o600 });
    const apple = await fakeApple([{ status: 403, reason: "ExpiredProviderToken" }, { status: 200 }]);
    const direct = new ApnsDirect({ dataDir, env: {}, origins: apple.origins, now: () => Date.UTC(2026, 10, 17, 12) });
    expect(direct.bundle()).toBe(CONFIG.bundleId);
    expect(await direct.send({ token: TOKEN, environment: "sandbox" }, PUSH, "openmaus.t1.4")).toEqual({ kind: "sent" });
    expect(apple.seen).toHaveLength(2);
    const { headers, body } = apple.seen[1]!;
    expect(headers[":path"]).toBe(`/3/device/${TOKEN}`);
    expect(headers["apns-topic"]).toBe(CONFIG.bundleId);
    expect(headers["apns-push-type"]).toBe("alert");
    expect(headers["apns-priority"]).toBe("10");
    expect(headers["apns-collapse-id"]).toBe("openmaus.t1.4");
    expect(String(headers.authorization)).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(body).toMatchObject({ aps: { alert: { title: PUSH.title, body: PUSH.body } }, omb: { messageId: "m9" } });
    direct.close();
  });

  it("answers dead for a token Apple dropped, retry for its busy answers, and failed without a key", async () => {
    const none = new ApnsDirect({ dataDir, env: {} });
    expect(none.bundle()).toBeNull();
    expect(await none.send({ token: TOKEN, environment: "production" }, PUSH)).toMatchObject({ kind: "failed", reason: "no key" });
    writeFileSync(join(dataDir, APNS_DIRECT_FILE), JSON.stringify(CONFIG), { mode: 0o600 });
    const apple = await fakeApple([{ status: 410, reason: "Unregistered" }, { status: 400, reason: "BadDeviceToken" }, { status: 503, reason: "ServiceUnavailable" }, { status: 400, reason: "PayloadTooLarge" }]);
    const direct = new ApnsDirect({ dataDir, env: {}, origins: apple.origins });
    expect(await direct.send({ token: TOKEN, environment: "production" }, PUSH)).toEqual({ kind: "dead" });
    expect(await direct.send({ token: TOKEN, environment: "production" }, PUSH)).toEqual({ kind: "dead" });
    expect(await direct.send({ token: TOKEN, environment: "production" }, PUSH)).toMatchObject({ kind: "retry", status: 503 });
    expect(await direct.send({ token: TOKEN, environment: "production" }, PUSH)).toMatchObject({ kind: "failed", status: 400, reason: "PayloadTooLarge" });
    direct.close();
  });

  it("is quiet at night: priority 5 and no sound", async () => {
    writeFileSync(join(dataDir, APNS_DIRECT_FILE), JSON.stringify(CONFIG), { mode: 0o600 });
    const apple = await fakeApple([]);
    const direct = new ApnsDirect({ dataDir, env: {}, origins: apple.origins, now: () => Date.parse("2026-11-17T23:30:00Z") });
    await direct.send({ token: TOKEN, environment: "production", quiet: { start: "22:00", end: "07:00", timeZone: "UTC" } }, PUSH);
    expect(apple.seen[0]!.headers["apns-priority"]).toBe("5");
    expect(apple.seen[0]!.body).toMatchObject({ aps: { "interruption-level": "passive" } });
    expect((apple.seen[0]!.body as { aps: Record<string, unknown> }).aps.sound).toBeUndefined();
    direct.close();
  });
});
