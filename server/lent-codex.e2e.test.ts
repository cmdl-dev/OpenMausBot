import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";
import { createComputerSharing } from "../electron/computer-sharing.mjs";

/** codex-cli 0.166.0's computer-use question, as a real `codex app-server` sends it. */
const question = (app: string, bundle: string) => ({
  serverName: "cua_repl", mode: "form", message: `Allow Computer Use to use "${app}"?`, requestedSchema: { type: "object", properties: {} },
  _meta: { codex_approval_kind: "mcp_tool_call", connector_id: "computer-use", connector_name: "Computer Use", persist: ["session", "always"],
    tool_name: "get_app_state", tool_params: { app: bundle }, tool_params_display: [{ display_name: "App", name: "app", value: app }] },
});

let fixture: VerificationServer;
let connector: ReturnType<typeof createComputerSharing>;
let proxy: ChildProcess;
let token: string;
let bot: any;
let sequence = 0;
const env = { id: "own-server", name: "Own server", origin: "" };
const waiting = new Map<number, (value: any) => void>();
const codexJobs: Array<{ prompt: string; answers: unknown[] }> = [];

const api = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${fixture.info.url}${path}`, {
    method, headers: { "content-type": "application/json", origin: fixture.info.url, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as any };
};
const rpc = (method: string, params?: unknown): Promise<any> => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timeout = setTimeout(() => { waiting.delete(id); reject(new Error(`MCP ${method} timed out`)); }, 60_000);
  waiting.set(id, value => { clearTimeout(timeout); resolve(value); });
  proxy.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
});
const tool = async (name: string, args: unknown = {}) => (await rpc("tools/call", { name, arguments: args })).result;
const computers = async () => JSON.parse((await tool("list_shared_computers")).content[0].text).computers as any[];
const codexCards = async () => ((await api("GET", `/api/threads/${bot.threadId}/messages?limit=200`)).body.messages as any[])
  .filter(message => message.card?.tool === "lent_codex_app");
const openCard = async (app: string) => {
  let card: any;
  await vi.waitFor(async () => {
    card = (await codexCards()).find(message => !message.card.answered && message.card.title.includes(app))?.card;
    expect(card).toBeTruthy();
  }, { timeout: 20_000, interval: 200 });
  return card;
};
const lendOnly = async (input: { codex?: boolean; computer?: boolean }) => {
  await connector.lendOwn(env, input);
  await vi.waitFor(async () => expect((await computers())[0]?.codex).toBe(input.codex === true), { timeout: 20_000, interval: 250 });
};

beforeAll(async () => {
  fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "hang" });
  env.origin = fixture.info.url;
  const opened = await api("POST", "/api/auth/pairing", { label: "Mac fixture", scopes: ["admin", "client"] });
  expect(opened.status).toBe(200);
  token = (await api("POST", "/api/auth/pair", { code: opened.body.code })).body.token;
  expect(token).toMatch(/^omb_sess_/);
  const session = (await api("GET", "/api/auth/session")).body;
  expect(session).toMatchObject({ own: true, lending: { codexTasks: true } });
  connector = createComputerSharing({
    file: join(fixture.info.dataDir, "desktop-profile", "computer-sharing.json"), environments: () => [env], cuaConnection: async () => null,
    fetch: (url: string, init: RequestInit) => fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } }),
    // Stands in for this computer's Codex: asks about Finder twice (as codex-cli does before every call), then TextEdit.
    codexTask: async ({ prompt, ask }) => {
      const answers = [await ask(question("Finder", "com.apple.finder")), await ask(question("Finder", "com.apple.finder")), await ask(question("TextEdit", "com.apple.TextEdit"))];
      codexJobs.push({ prompt, answers });
      return { content: [{ type: "text", text: `Codex finished: ${prompt}` }] };
    },
  });
  // A turn lists the lent-computer tools only when something is lent as it starts.
  await connector.lendOwn(env, { computer: true });
  await vi.waitFor(async () => expect((await api("GET", "/api/shared-computers")).body.computers?.[0]?.online).toBe(true), { timeout: 20_000, interval: 250 });
  bot = (await api("POST", "/api/bots", { name: "Mac helper" })).body.bot;
  const dump = join(fixture.info.dataDir, "fake-claude-dump.json");
  rmSync(dump, { force: true });
  expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Use Codex on my Mac." })).status).toBe(202);
  await vi.waitFor(() => expect(existsSync(dump)).toBe(true), { timeout: 15_000 });
  const agents = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.agents;
  proxy = spawn(agents.command, agents.args, { env: { PATH: process.env.PATH, HOME: fixture.info.dataDir, ...agents.env }, stdio: ["pipe", "pipe", "pipe"] });
  createInterface({ input: proxy.stdout! }).on("line", line => { const message = JSON.parse(line); waiting.get(message.id)?.(message); waiting.delete(message.id); });
  await rpc("initialize", { protocolVersion: "2024-11-05" });
}, 60_000);

afterAll(async () => {
  connector?.close(); proxy?.kill();
  await fixture?.close();
});

it("refuses codex_task while this computer lends no Codex", async () => {
  await lendOnly({ computer: true });
  const [computer] = await computers();
  const refused = await tool("shared_computer", { computer_id: computer.id, action: "codex_task", prompt: "Read Finder's window title" });
  expect(refused.isError).toBe(true);
  expect(refused.content[0].text).toContain("doesn't lend its Codex");
  expect(codexJobs).toEqual([]);
}, 60_000);

it("at Just do it, Codex there gets every app without a card", async () => {
  await lendOnly({ codex: true });
  const [computer] = await computers();
  const result = await tool("shared_computer", { computer_id: computer.id, action: "codex_task", prompt: "Count Finder windows" });
  expect(result.content[0].text).toContain("Codex finished: Count Finder windows");
  expect(codexJobs.pop()).toEqual({ prompt: "Count Finder windows", answers: Array(3).fill({ action: "accept", content: {} }) });
  expect(await codexCards()).toEqual([]);
}, 60_000);

it("hands the job to Codex there, asks the person once per app, and returns Codex's answer", async () => {
  expect((await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "ask" })).status).toBe(200);
  const [computer] = await computers();
  const running = tool("shared_computer", { computer_id: computer.id, action: "codex_task", prompt: "Read Finder's window title" });
  const finder = await openCard("Finder");
  expect(finder.title).toBe(`Let Codex on ${computer.name} use Finder?`);
  expect((await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: finder.requestId, behavior: "allow" })).status).toBe(200);
  const textEdit = await openCard("TextEdit");
  expect((await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: textEdit.requestId, behavior: "deny" })).status).toBe(200);
  const result = await running;
  expect(result.isError).not.toBe(true);
  expect(result.content[0].text).toContain("Codex finished: Read Finder's window title");
  expect(codexJobs).toEqual([{ prompt: "Read Finder's window title", answers: [
    { action: "accept", content: {} },
    { action: "accept", content: {} },
    { action: "decline" },
  ] }]);
  const cards = await codexCards();
  expect(cards.map(message => [message.card.title.includes("Finder") ? "Finder" : "TextEdit", message.card.answered])).toEqual([["Finder", "allow"], ["TextEdit", "deny"]]);
}, 90_000);

it("a question for a job that is not a running codex_task of this computer is declined without a card", async () => {
  const before = (await codexCards()).length;
  const grant = JSON.parse(readFileSync(join(fixture.info.dataDir, "desktop-profile", "computer-sharing.json"), "utf8")).records[env.id];
  const response = await fetch(`${fixture.info.url}/api/shared-computers/${grant.id}/codex-app`, {
    method: "POST", headers: { "content-type": "application/json", origin: fixture.info.url, authorization: `Bearer ${token}`, "x-omb-computer-secret": grant.secret },
    body: JSON.stringify({ jobId: "00000000-0000-4000-8000-000000000000", questionId: "q1", request: question("Finder", "com.apple.finder") }),
  });
  expect(await response.json()).toEqual({ response: { action: "decline" } });
  expect((await codexCards()).length).toBe(before);
});
