import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { codexAppAnswer, runCodexTask } from "./codex-task.mjs";

/** The computer-use question codex-cli 0.166.0 sends before each call, as captured from a real `codex app-server`. */
const FINDER_QUESTION = {
  serverName: "cua_repl", mode: "form", message: "Allow Computer Use to use \"Finder\"?", requestedSchema: { type: "object", properties: {} },
  _meta: { codex_approval_kind: "mcp_tool_call", connector_id: "computer-use", connector_name: "Computer Use", persist: ["session", "always"],
    tool_name: "get_app_state", tool_params: { app: "com.apple.finder" }, tool_params_display: [{ display_name: "App", name: "app", value: "Finder" }] },
};

/** A stand-in `codex app-server`: the handshake, then the scenario named by argv, logging what the client sent. */
const FAKE = `
const fs = require("node:fs");
const readline = require("node:readline");
const [mode, logFile] = process.argv.slice(2);
const log = entry => fs.appendFileSync(logFile, JSON.stringify(entry) + "\\n");
const send = message => process.stdout.write(JSON.stringify(message) + "\\n");
const question = ${JSON.stringify(FINDER_QUESTION)};
const finish = (text, status = "completed") => {
  send({ jsonrpc: "2.0", method: "item/completed", params: { item: { type: "agentMessage", text } } });
  send({ jsonrpc: "2.0", method: "turn/completed", params: { turn: { status, ...(status === "failed" ? { error: { message: "model refused" } } : {}) } } });
};
log({ env: Object.keys(process.env).sort(), cwd: process.cwd() });
readline.createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  log(message);
  if (message.method === "initialize") return send({ jsonrpc: "2.0", id: message.id, result: { userAgent: "fake/0.166.0" } });
  if (message.method === "thread/start") return send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "thread-1" } } });
  if (message.method === "turn/start") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    if (mode === "hang") return;
    if (mode === "fail") return finish("", "failed");
    if (mode === "command") return send({ jsonrpc: "2.0", id: "c1", method: "item/commandExecution/requestApproval", params: { command: "rm -rf ~" } });
    return send({ jsonrpc: "2.0", id: "q1", method: "mcpServer/elicitation/request", params: question });
  }
  if (message.id === "c1") return finish("ran nothing");
  if (message.id === "q1") {
    if (message.result?.action !== "accept") return finish("Computer Use was not approved to use Finder.");
    send({ jsonrpc: "2.0", method: "item/completed", params: { item: { type: "mcpToolCall", status: "completed" } } });
    return send({ jsonrpc: "2.0", id: "q2", method: "mcpServer/elicitation/request", params: question });
  }
  if (message.id === "q2") {
    send({ jsonrpc: "2.0", method: "item/completed", params: { item: { type: "mcpToolCall", status: "completed" } } });
    return finish("Finder's window is Downloads.");
  }
});
`;

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-task-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, "fake-app-server.cjs");
  fs.writeFileSync(script, FAKE);
  const logFile = path.join(dir, "log.jsonl");
  const launch = mode => [process.execPath, [script, mode, logFile]];
  const sent = () => fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
  return { launch, sent };
}

test("each app question goes to ask, and the accepted job returns Codex's final answer", async t => {
  const { launch, sent } = fixture(t);
  const asked = [];
  const result = await runCodexTask({
    prompt: "Read Finder's window title", launch: launch("accept"),
    env: { ...process.env, OPENAI_API_KEY: "must-not-pass", HOME: os.homedir() },
    ask: async request => { asked.push(request); return { action: "accept", content: {} }; },
  });
  assert.equal(asked.length, 2);
  assert.deepEqual(asked[0], FINDER_QUESTION);
  assert.match(result.content[0].text, /^Finder's window is Downloads\./);
  assert.match(result.content[0].text, /2 tool calls/);
  const messages = sent();
  assert.ok(!messages[0].env.includes("OPENAI_API_KEY"), "no API key reaches Codex from this app's environment");
  const thread = messages.find(message => message.method === "thread/start");
  assert.equal(thread.params.sandbox, "read-only");
  assert.equal(thread.params.ephemeral, true);
  const turn = messages.find(message => message.method === "turn/start");
  assert.deepEqual(turn.params.input, [{ type: "text", text: "Read Finder's window title" }]);
  assert.deepEqual(turn.params.sandboxPolicy, { type: "readOnly" });
  assert.deepEqual(messages.find(message => message.id === "q1").result, { action: "accept", content: {} });
  assert.ok(!fs.existsSync(messages[0].cwd), "its scratch folder is removed");
});

test("a declined or failed ask declines, and Codex's refusal is the answer", async t => {
  const { launch, sent } = fixture(t);
  const result = await runCodexTask({ prompt: "Read Finder", launch: launch("accept"), ask: async () => { throw new Error("server gone"); } });
  assert.match(result.content[0].text, /not approved to use Finder/);
  assert.deepEqual(sent().find(message => message.id === "q1").result, { action: "decline" });
});

test("anything but app access is refused on this computer, never asked", async t => {
  const { launch, sent } = fixture(t);
  let asked = 0;
  await runCodexTask({ prompt: "Clean up", launch: launch("command"), ask: async () => { asked += 1; return { action: "accept", content: {} }; } });
  assert.equal(asked, 0);
  assert.deepEqual(sent().find(message => message.id === "c1").result, { decision: "decline" });
});

test("a failed turn, a timeout and a stop each end the job with a reason", async t => {
  const { launch } = fixture(t);
  await assert.rejects(runCodexTask({ prompt: "x", launch: launch("fail"), ask: async () => null }), /Codex could not finish: model refused/);
  await assert.rejects(runCodexTask({ prompt: "x", launch: launch("hang"), timeoutSeconds: 1, ask: async () => null }), /did not finish within 1 seconds/);
  const stop = new AbortController();
  const running = runCodexTask({ prompt: "x", launch: launch("hang"), signal: stop.signal, ask: async () => null });
  setTimeout(() => stop.abort(), 300);
  await assert.rejects(running, /stopped before Codex finished/);
  await assert.rejects(runCodexTask({ prompt: "x", launch: ["omb-no-such-codex-binary", []], ask: async () => null }), /Codex isn't installed/);
  await assert.rejects(runCodexTask({ prompt: "  ", launch: launch("accept"), ask: async () => null }), /whole job in prompt/);
});

test("only a decline or a small flat accept reaches Codex", () => {
  assert.deepEqual(codexAppAnswer({ action: "accept", content: {} }), { action: "accept", content: {} });
  assert.deepEqual(codexAppAnswer({ action: "accept", content: { decision: "allow" } }), { action: "accept", content: { decision: "allow" } });
  assert.deepEqual(codexAppAnswer({ action: "accept", content: { nested: { x: 1 } } }), { action: "decline" });
  assert.deepEqual(codexAppAnswer({ action: "accept" }), { action: "decline" });
  assert.deepEqual(codexAppAnswer(undefined), { action: "decline" });
  assert.deepEqual(codexAppAnswer({ action: "cancel" }), { action: "decline" });
});
