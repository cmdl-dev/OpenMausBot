// A real Cloud home and its agents tools: a bot calls notify_person, and the note lands in its chat as an alert, the
// notification feed points at it, and the owner's phone of an app whose APNs key this server holds gets a push from
// here, at a local stand-in for Apple. A bot whose notifications are off sends nothing.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Http2Server, type IncomingHttpHeaders } from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { APNS_DIRECT_FILE } from "./apns-direct.ts";
import { cloudHomeConfiguration, cloudPairingSignature } from "./cloud-home.ts";
import { cloudHomeChildEnvironments, spawnWithSecrets } from "./cloud-home-start.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const HOST = "omb-t-6ad2e7f1a0c1.fly.dev";
const BUNDLE = "com.example.steinhub";
const TOKEN = "ab".repeat(32);
const bootstrap = randomBytes(32).toString("base64url");
let home = "";
let base = "";
let child: ChildProcess;
let log = "";
let owner = "";
let apple: Http2Server;
const pushes: Array<{ headers: IncomingHttpHeaders; body: any }> = [];
const proxies: ChildProcess[] = [];

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      host: HOST, "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https", origin: `https://${HOST}`,
      ...(owner ? { authorization: `Bearer ${owner}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch {}
  return { status: response.status, body: parsed };
}

async function pairOwner(): Promise<string> {
  const body = JSON.stringify({ label: "OpenMausBot app (Cloud)", ttlSeconds: 300 });
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(16).toString("base64url");
  const response = await fetch(`${base}/api/cloud/pairing`, { method: "POST", headers: {
    host: HOST, "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https", "content-type": "application/json",
    "x-omb-cloud-timestamp": timestamp, "x-omb-cloud-nonce": nonce, "x-omb-cloud-signature": `v1=${cloudPairingSignature(bootstrap, timestamp, nonce, body)}`,
  }, body });
  const granted = await response.json() as { code: string };
  const paired = await api("POST", "/api/auth/pair", { code: granted.code });
  expect(paired.status, JSON.stringify(paired.body)).toBe(200);
  return paired.body.token;
}

async function proxyFor(start: () => Promise<void>) {
  const dump = join(home, "spawn.json");
  rmSync(dump, { force: true });
  await start();
  let agents: { command: string; args: string[]; env: Record<string, string> } | undefined;
  await expect.poll(() => {
    try { agents = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.agents; return true; } catch { return false; }
  }, { timeout: 15_000 }).toBe(true);
  const proxy = spawn(agents!.command, agents!.args, { env: { PATH: process.env.PATH, HOME: home, ...agents!.env }, stdio: ["pipe", "pipe", "pipe"] });
  proxies.push(proxy);
  const replies = new Map<number, (value: any) => void>();
  createInterface({ input: proxy.stdout! }).on("line", (line) => { const message = JSON.parse(line); replies.get(message.id)?.(message.result); replies.delete(message.id); });
  let next = 0;
  const request = (method: string, params: unknown): Promise<any> => new Promise((resolve) => {
    const id = ++next; replies.set(id, resolve);
    proxy.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  await request("initialize", { protocolVersion: "2024-11-05" });
  return async (name: string, args: unknown = {}) => {
    const result = await request("tools/call", { name, arguments: args });
    return { text: String(result.content?.[0]?.text ?? ""), isError: result.isError === true };
  };
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-notify-person-"));
  const dataDir = join(home, ".openmausbot");
  mkdirSync(dataDir, { recursive: true });
  apple = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      pushes.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      res.writeHead(200);
      res.end();
    });
  });
  await new Promise<void>((ready) => apple.listen(0, "127.0.0.1", ready));
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  writeFileSync(join(dataDir, APNS_DIRECT_FILE), JSON.stringify({
    keyId: "KEY1234567", teamId: "TEAM123456", bundleId: BUNDLE, privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  }), { mode: 0o600 });
  const cli = join(home, "fixture-claude.mjs");
  writeFileSync(cli, `#!/usr/bin/env node
if (process.argv[2] === "auth") { console.log(JSON.stringify({ loggedIn: true, email: "person@example.test" })); process.exit(0); }
process.env.FAKE_CLAUDE_VERSION = "2.1.284";
if (process.argv[2] !== "--version") { process.env.FAKE_CLAUDE_DUMP = ${JSON.stringify(join(home, "spawn.json"))}; process.env.FAKE_CLAUDE_MODE = "hang"; }
await import(${JSON.stringify(pathToFileURL(join(SERVER_DIR, "testing", "fake-claude-cli.ts")).href)});
`, { mode: 0o755 });
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({ instances: {
    ...Object.fromEntries(["codex", "cursor", "githubCopilot", "openaiCompat", "qwen", "hermes", "pi", "grok"].map((id) => [id, { driver: "not-a-real-driver" }])),
    claude: { driver: "claudeAgent", displayName: "Claude", config: { cli } },
  } }));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  const contract = { OMB_CLOUD_ROLE: "home", OMB_CLOUD_MACHINE_ID: "8e2d4c6b-3f5a-4b7c-9d0e-1f2a3b4c5d6e", OMB_CLOUD_ADMIN_URL: "https://cloud.example.test",
    OMB_CLOUD_BOOTSTRAP_SECRET: bootstrap, OMB_PUBLIC_URL: `https://${HOST}` };
  const imageEnv = { PATH: process.env.PATH, OMB_DUCKDB_DIR: join(home, "empty-tree"), ...contract };
  const { server, secrets } = cloudHomeChildEnvironments(cloudHomeConfiguration(imageEnv)!, imageEnv, home);
  const offline = `data:text/javascript,${encodeURIComponent('const real = globalThis.fetch; globalThis.fetch = async (url, init) => String(url).startsWith("http://127.0.0.1:") ? real(url, init) : new Response("offline fixture", { status: 503 });')}`;
  child = spawnWithSecrets(process.execPath, ["--import", offline, join(SERVER_DIR, "index.ts")], {
    ...server, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1), USERPROFILE: home,
    OMB_APNS_ORIGIN: `http://127.0.0.1:${(apple.address() as AddressInfo).port}`,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  }, secrets, null, true);
  child.stdout?.on("data", (chunk) => { log += chunk; });
  child.stderr?.on("data", (chunk) => { log += chunk; });
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the Cloud home exited:\n${log}`);
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`the Cloud home did not start:\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  owner = await pairOwner();
}, hostTimeout(30_000));

afterAll(async () => {
  for (const proxy of proxies) proxy.kill();
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (apple) await new Promise((done) => apple.close(done));
  if (home) await removeTempDir(home);
});

it("posts the note as an alert, points the notification at it, and pushes the owner's phone straight from here", async () => {
  const registered = await api("PUT", "/api/push/device", { platform: "apns", token: TOKEN, environment: "sandbox", bundle: BUNDLE, kinds: ["alert"], pairing: "pair-tag-0001" });
  expect(registered).toMatchObject({ status: 200, body: { push: "on", device: { bundle: BUNDLE, kinds: ["alert"] } } });

  const bot = (await api("POST", "/api/bots", { name: "Inbox Watch", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } })).body.bot;
  const call = await proxyFor(async () => {
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Watch my email and tell me if anything is urgent." })).status).toBe(202);
  });
  const sent = await call("notify_person", { title: "Lease renewal due Friday", text: "Your landlord wants an answer about the lease **by Friday**." });
  expect(sent).toEqual({ isError: false, text: expect.stringContaining("The person was notified") });

  const note = (await api("GET", `/api/threads/${bot.threadId}/messages`)).body.messages.find((message: any) => message.alert);
  expect(note).toMatchObject({ role: "bot", kind: "text", text: "Your landlord wants an answer about the lease **by Friday**.", alert: { title: "Lease renewal due Friday" } });
  const feed = (await api("GET", "/api/notifications")).body;
  const entries = Array.isArray(feed) ? feed : feed.notifications ?? feed.entries ?? [];
  expect(entries).toContainEqual(expect.objectContaining({ kind: "alert", botId: bot.id, threadId: bot.threadId, messageId: note.id, body: "Lease renewal due Friday" }));

  await expect.poll(() => pushes.length, { timeout: 10_000 }).toBe(1);
  const push = pushes[0]!;
  expect(push.headers[":path"]).toBe(`/3/device/${TOKEN}`);
  expect(push.headers["apns-topic"]).toBe(BUNDLE);
  expect(push.body).toMatchObject({
    aps: { alert: { title: "Inbox Watch flagged something for you", body: "Lease renewal due Friday" }, "thread-id": bot.threadId },
    omb: { v: 1, kind: "alert", botId: bot.id, threadId: bot.threadId, messageId: note.id, pairing: "pair-tag-0001" },
  });

  expect((await api("PATCH", `/api/bots/${bot.id}`, { notifications: false })).status).toBe(200);
  const off = await call("notify_person", { title: "Another thing", text: "More." });
  expect(off).toEqual({ isError: true, text: expect.stringContaining("turned notifications off") });
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(pushes).toHaveLength(1);
  const notes = (await api("GET", `/api/threads/${bot.threadId}/messages`)).body.messages.filter((message: any) => message.alert);
  expect(notes).toHaveLength(1);
}, hostTimeout(60_000));
