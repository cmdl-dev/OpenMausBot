// Real HTTP boundary, disposable home/data, a synthetic Router answering through a fetch stand-in.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROUTER = "https://router-fixture.example:8317";
const API_KEY = "router-api-fixture-secret";
const MANAGEMENT_KEY = "router-management-fixture-secret";
let home: string;
let dataDir: string;
let base: string;
let clientToken: string;
let child: ChildProcess;
let stderr = "";

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

function saved() {
  return JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
}

function hubFile() {
  try { return JSON.parse(readFileSync(join(dataDir, "usage-hubs.json"), "utf8")); } catch { return { hubs: [] }; }
}

async function idle(id: string) {
  await expect.poll(async () => (await api("GET", "/api/bots?messages=30")).body.bots.find((row: any) => row.id === id)?.busy, { timeout: 10_000 }).toBe(false);
}

// The Router lists Anthropic and OpenAI chat models, an image model and another vendor's model; a later read adds one.
const routerFetch = `
let reads = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const target = String(url);
  if (!target.startsWith(${JSON.stringify(ROUTER)})) return target.startsWith("http://127.0.0.1") ? realFetch(url, init) : new Response("offline fixture", { status: 503 });
  const auth = new Headers(init.headers).get("authorization");
  if (target === ${JSON.stringify(`${ROUTER}/v1/models`)}) {
    if (auth !== "Bearer ${API_KEY}") return Response.json({ error: "bad key" }, { status: 401 });
    reads++;
    return Response.json({ data: [
      { id: "claude-sonnet-5-5", owned_by: "anthropic" }, { id: "claude-opus-5-5", owned_by: "anthropic" },
      { id: "gpt-6.1-sol", owned_by: "openai" }, { id: "gpt-image-2", owned_by: "openai" }, { id: "muse-spark-1.3", owned_by: "meta" },
      ...(reads > 2 ? [{ id: "gpt-6-luna", owned_by: "openai" }] : []),
    ] });
  }
  if (target === ${JSON.stringify(`${ROUTER}/v0/management/auth-files`)}) {
    if (auth !== "Bearer ${MANAGEMENT_KEY}") return Response.json({ error: "bad key" }, { status: 401 });
    return Response.json({ files: [{ id: "claude.json", auth_index: "1", provider: "claude", email: "owner@example.test" }] });
  }
  return new Response("not found", { status: 404 });
};`;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-router-api-"));
  dataDir = join(home, ".openmausbot");
  mkdirSync(dataDir, { recursive: true });
  const cli = join(home, "fixture-claude.mjs");
  writeFileSync(cli, `#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const dir = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME, ".claude");
if (process.argv[2] === "auth") { console.log(JSON.stringify({ loggedIn: true, email: "own@example.test" })); process.exit(0); }
if (process.argv[2] !== "--version") {
  mkdirSync(dir, { recursive: true });
  process.env.FAKE_CLAUDE_MODE = "happy";
  process.env.FAKE_CLAUDE_DUMP = join(dir, "spawn.json");
  process.env.FAKE_CLAUDE_REPLIES = JSON.stringify(["through the router"]);
}
await import(${JSON.stringify(pathToFileURL(join(SERVER_DIR, "testing", "fake-claude-cli.ts")).href)});
`, { mode: 0o755 });
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({
    instances: {
      // Pinned shadows keep the fleet from probing an installed provider CLI.
      ...Object.fromEntries(["cursor", "githubCopilot", "openaiCompat", "qwen", "hermes", "pi"].map(id => [id, { driver: "not-a-real-driver" }])),
      codex: { driver: "codex", config: { cli: join(SERVER_DIR, "testing", "fake-codex-app-server.ts") } },
      claude: { driver: "claudeAgent", displayName: "Own Claude", config: { cli } },
    },
  }));
  const sessions = new SessionRegistry({ file: join(dataDir, "sessions.json") });
  const paired = sessions.exchange({ code: sessions.openPairing({ scopes: ["client"] }).code, label: "Fixture client", source: "fixture" });
  if (!paired.ok) throw new Error("fixture session failed");
  clientToken = paired.token;
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(routerFetch)}`, join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      PATH: process.env.PATH,
      ...(process.env.PATHEXT ? { PATHEXT: process.env.PATHEXT } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home, USERPROFILE: home, OMB_DATA_DIR: dataDir,
      OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1), OMB_SSE_HEARTBEAT_MS: "50",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.resume();
  child.stderr?.on("data", chunk => { stderr = (stderr + chunk).slice(-16_384); });
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`fixture exited: ${stderr}`);
    try { if ((await api("GET", "/api/health")).body.pid === child.pid) break; } catch {}
    if (Date.now() > deadline) throw new Error(`fixture did not start: ${stderr}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}, 30_000);

afterAll(async () => {
  await waitForExit(child, { signal: "SIGTERM" });
  if (home) await removeTempDir(home);
});

describe("Router HTTP API", () => {
  it("refuses a wrong key, a plain-HTTP address off this computer and a client session without saving anything", async () => {
    const before = saved().instances;
    expect((await api("POST", "/api/routers", { url: ROUTER, apiKey: "wrong-key" })).body.error).toMatch(/refused the API key/);
    expect((await api("POST", "/api/routers", { url: "http://router.example:8317", apiKey: API_KEY })).status).toBe(400);
    expect((await api("POST", "/api/routers", { url: ROUTER, apiKey: API_KEY }, { authorization: `Bearer ${clientToken}` })).status).toBe(403);
    expect(saved().instances).toEqual(before);
    expect(hubFile().hubs).toEqual([]);
  });

  it("connects a Router as a Claude and an OpenAI account, runs a turn through it and removes it whole", async () => {
    const created = await api("POST", "/api/routers", { url: `${ROUTER}/v1/`, apiKey: API_KEY });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain(API_KEY);
    const [router] = created.body.routers;
    expect(router).toMatchObject({ label: "Router", url: ROUTER, usage: false });
    const claudeId = `router-${router.id}-claude`;
    const codexId = `router-${router.id}-codex`;
    expect(router.engines).toEqual([
      { instanceId: claudeId, engine: "claude", models: 2 },
      { instanceId: codexId, engine: "codex", models: 2 },
    ]);
    const rows = created.body.instances;
    const claude = rows.find((row: any) => row.instanceId === claudeId);
    const codex = rows.find((row: any) => row.instanceId === codexId);
    expect(claude).toMatchObject({ driverKind: "claudeAgent", displayName: "Router", access: "subscription", router: { id: router.id, label: "Router" } });
    expect(claude.claudeEndpoint).toBeUndefined();
    expect(claude.models.options.map((option: any) => option.id)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(claude.models.options.some((option: any) => option.custom)).toBe(false);
    expect(codex).toMatchObject({ driverKind: "codex", access: "subscription", router: { id: router.id } });
    expect(codex.codexEndpoint).toBeUndefined();
    expect(codex.models.options.map((option: any) => option.id)).toEqual(["gpt-6.1-sol", "muse-spark-1.3"]);
    expect(saved().instances[claudeId]).toMatchObject({
      config: { requireApiKey: true, router: router.id },
      environment: { ANTHROPIC_BASE_URL: ROUTER, ANTHROPIC_API_KEY: API_KEY },
    });
    expect(saved().instances[codexId]).toMatchObject({
      config: { endpoint: { url: `${ROUTER}/v1` }, router: router.id },
      environment: { OPENMAUSBOT_CODEX_API_KEY: API_KEY },
    });
    expect(JSON.stringify((await api("GET", "/api/instances")).body)).not.toContain(API_KEY);
    expect((await api("POST", "/api/routers", { url: ROUTER, apiKey: API_KEY })).body.error).toMatch(/already connected/);

    const made = await api("POST", "/api/bots", { name: "Router bot", modelSelection: { instanceId: claudeId, model: "claude-opus-5-5" }, requireAvailableModel: true });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const bot = made.body.bot;
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "which way" })).status).toBe(202);
    await idle(bot.id);
    const turn = JSON.parse(readFileSync(join(saved().instances[claudeId].config.configDir, "spawn.json"), "utf8"));
    expect(turn.env).toMatchObject({ ANTHROPIC_BASE_URL: ROUTER, ANTHROPIC_AUTH_TOKEN: API_KEY });
    expect(turn.argv[turn.argv.indexOf("--model") + 1]).toBe("claude-opus-5-5");

    expect((await api("DELETE", `/api/instances/${claudeId}`)).body.error).toMatch(/belongs to a Router/);
    expect((await api("DELETE", `/api/routers/${router.id}`)).status).toBe(409);
    expect((await api("PATCH", `/api/bots/${bot.id}/model`, { instanceId: "claude", model: "claude-sonnet-5" })).status).toBe(200);
    const removed = await api("DELETE", `/api/routers/${router.id}`);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body.routers).toEqual([]);
    expect(saved().instances).not.toHaveProperty(claudeId);
    expect(saved().instances).not.toHaveProperty(codexId);
    expect(hubFile().hubs).toEqual([]);
  });

  it("edits keys, reads usage with a checked management key and refreshes the model list", async () => {
    const created = await api("POST", "/api/routers", { label: "Home router", url: ROUTER, apiKey: API_KEY });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.routers[0].id;
    expect((await api("PATCH", `/api/routers/${id}`, { managementKey: "wrong-management-key" })).body.error).toMatch(/refused the management key/);
    const metered = await api("PATCH", `/api/routers/${id}`, { managementKey: MANAGEMENT_KEY });
    expect(metered.status, JSON.stringify(metered.body)).toBe(200);
    expect(metered.body.routers[0]).toMatchObject({ label: "Home router", usage: true });
    expect(JSON.stringify(metered.body)).not.toContain(MANAGEMENT_KEY);
    expect((await api("GET", "/api/plan-usage/hubs")).body.hubs).toEqual([]);
    expect((await api("DELETE", `/api/plan-usage/hubs/${id}`)).status).toBe(404);
    expect((await api("PATCH", `/api/routers/${id}`, { url: "https://other-router.example" })).body.error).toMatch(/API key again/);

    const refreshed = await api("POST", `/api/routers/${id}/refresh`, {});
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
    expect(saved().instances[`router-${id}-codex`].config.endpoint.models).toEqual(["gpt-6.1-sol", "muse-spark-1.3", "gpt-6-luna"]);
    expect(saved().instances[`router-${id}-claude`].environment.ANTHROPIC_API_KEY).toBe(API_KEY);

    const unmetered = await api("PATCH", `/api/routers/${id}`, { managementKey: "" });
    expect(unmetered.body.routers[0].usage).toBe(false);
    expect((await api("DELETE", `/api/routers/${id}`)).status).toBe(200);
  });
});
