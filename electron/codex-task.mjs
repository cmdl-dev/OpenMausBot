// One codex_task: this computer's own signed-in Codex runs the job through `codex app-server` with computer use on, so it
// works in this computer's apps itself. Codex asks before it uses each app; `ask` takes that question to the person on the
// server that sent the job and returns their answer. Nothing else Codex asks for is granted here.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { inheritedEnvironment } from "./lent-mcp.mjs";
import { commandPath } from "./shell-path.mjs";

export const CODEX_TASK_SECONDS = 600;
const MAX_CODEX_TASK_SECONDS = 900;
const ANSWER_LIMIT = 200_000;
const STOP_GRACE_MS = 3000;
/** Read-only: Codex works through its computer-use tools, not by writing files or running commands that change them. */
const THREAD_PERMISSIONS = { approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "read-only" };
const TURN_PERMISSIONS = { approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly" } };

const record = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A codex_task names its whole job in `prompt`; any other job carries none longer than a job could. */
export const validCodexJob = operation => operation.prompt === undefined ? operation.action !== "codex_task"
  : typeof operation.prompt === "string" && operation.prompt.length <= 20_000 && (operation.action !== "codex_task" || operation.prompt.trim().length > 0);

/** One leased codex_task: each app question goes to the server that sent the job (POST …/codex-app), asked again while the
 * person has not answered, since a held request ends before they may. */
export const codexJob = (codexTask, call, jobId, log) => (operation, signal) => codexTask({
  prompt: operation.prompt, timeoutSeconds: operation.timeout_seconds, signal, log,
  ask: async request => {
    const questionId = randomUUID();
    for (;;) {
      const answer = await call("codex-app", { jobId, questionId, request }, signal);
      if (answer?.pending !== true) return answer?.response;
    }
  },
});

/** Only "decline", or "accept" with a flat form of short strings (none, for computer use), ever reaches Codex. */
export function codexAppAnswer(response) {
  if (!record(response) || response.action !== "accept" || !record(response.content)) return { action: "decline" };
  const entries = Object.entries(response.content);
  if (entries.length > 8 || !entries.every(([key, value]) => key.length <= 100 && typeof value === "string" && value.length <= 160)) return { action: "decline" };
  return { action: "accept", content: Object.fromEntries(entries) };
}

/** What Codex asks that this computer answers by itself: everything except app access is refused. */
function refusal(method) {
  if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") return { result: { decision: "decline" } };
  if (method === "execCommandApproval" || method === "applyPatchApproval") return { result: { decision: "denied" } };
  if (method === "item/permissions/requestApproval") return { result: { permissions: {}, scope: "turn" } };
  return { error: { code: -32601, message: `Not available for a lent Codex job: ${method}` } };
}

function stopTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  setTimeout(() => {
    if (child.exitCode !== null) return;
    try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }, STOP_GRACE_MS).unref();
}

/**
 * Runs `prompt` as one Codex turn and resolves with its final answer as an MCP-style result.
 * `ask(request)` gets each app-access elicitation Codex sends and resolves with the answer for Codex.
 * `launch` is for tests: [command, args] to start instead of `codex app-server`. `log` gets one line per step with its
 * time since the start, never the job's words.
 */
export async function runCodexTask({ prompt, timeoutSeconds = CODEX_TASK_SECONDS, signal, ask, launch, env = process.env, log = () => {} }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("Give codex_task the whole job in prompt");
  const seconds = Math.min(Math.max(1, Math.floor(timeoutSeconds)), MAX_CODEX_TASK_SECONDS);
  signal?.throwIfAborted();
  const began = Date.now();
  const step = what => log(`codex_task ${((Date.now() - began) / 1000).toFixed(1)}s ${what}`);
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omb-codex-task-"));
  const childEnv = { ...inheritedEnvironment(env), PATH: await commandPath({ env }), ...(env.CODEX_HOME ? { CODEX_HOME: env.CODEX_HOME } : {}) };
  const [command, args] = launch ?? ["codex", ["app-server", "-c", "features.computer_use=true"]];
  step("starting Codex");
  const child = spawn(command, args, { cwd, env: childEnv, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
  const stderr = [];
  child.stderr.on("data", chunk => { if (stderr.length < 40) stderr.push(String(chunk).slice(0, 2000)); });
  const pending = new Map();
  let nextId = 1, lastText = "", lastError = "", toolCalls = 0;
  const send = message => { if (child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`); };
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });

  let settle;
  const done = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  done.catch(() => {});
  const fail = error => settle.reject(error);
  const timer = setTimeout(() => fail(new Error(`Codex did not finish within ${seconds} seconds. Its work so far may have changed apps on this computer; look before retrying.`)), seconds * 1000);
  const aborted = () => fail(new Error("The job was stopped before Codex finished. Its work so far may have changed apps on this computer; look before retrying."));
  signal?.addEventListener("abort", aborted, { once: true });
  child.on("error", error => fail(error.code === "ENOENT" ? new Error("Codex isn't installed on this computer, or OpenMausBot can't find it. Install the Codex CLI and sign in to it here.") : error));
  child.on("exit", code => {
    for (const waiter of pending.values()) waiter.reject(new Error("Codex stopped"));
    pending.clear();
    fail(new Error(`Codex stopped before it finished (exit ${code ?? "signal"}).${stderr.length ? ` ${stderr.join("").trim().split("\n").slice(-3).join(" ").slice(0, 600)}` : ""}`));
  });

  const answerServerRequest = async message => {
    if (message.method !== "mcpServer/elicitation/request") {
      const { result, error } = refusal(message.method);
      return send({ jsonrpc: "2.0", id: message.id, ...(error ? { error } : { result }) });
    }
    const app = message.params?._meta?.tool_params?.app ?? message.params?.serverName ?? "an app";
    step(`asking about ${String(app).slice(0, 80)}`);
    let answer = { action: "decline" };
    try { answer = codexAppAnswer(await ask(message.params)); } catch (error) { step(`question failed: ${String(error?.message ?? error).slice(0, 200)}`); }
    step(`answered ${answer.action}`);
    send({ jsonrpc: "2.0", id: message.id, result: answer });
  };

  readline.createInterface({ input: child.stdout }).on("line", line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && !message.method) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter?.reject(new Error(String(message.error.message ?? "Codex refused the request")));
      else waiter?.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) return void answerServerRequest(message);
    const params = message.params ?? {};
    if (message.method === "item/completed" && params.item?.type === "agentMessage" && typeof params.item.text === "string" && params.item.text.trim()) lastText = params.item.text;
    else if (message.method === "item/completed" && params.item?.type === "mcpToolCall") toolCalls += 1;
    else if (message.method === "error" && params.willRetry !== true) lastError = String(params.error?.message ?? params.message ?? "");
    else if (message.method === "turn/completed") {
      const turn = params.turn ?? {};
      if (turn.status === "completed") settle.resolve();
      else fail(new Error(`Codex could not finish: ${turn.error?.message || lastError || turn.status || "failed"}`));
    }
  });

  try {
    await Promise.race([done, (async () => {
      await request("initialize", { clientInfo: { name: "openmausbot-lent", title: "OpenMausBot", version: "1" }, capabilities: { experimentalApi: true } });
      send({ jsonrpc: "2.0", method: "initialized", params: {} });
      step("Codex ready");
      const started = await request("thread/start", { cwd, ephemeral: true, ...THREAD_PERMISSIONS });
      const threadId = started?.thread?.id;
      if (typeof threadId !== "string") throw new Error("Codex did not start a session");
      await request("turn/start", { threadId, input: [{ type: "text", text: prompt }], ...TURN_PERMISSIONS });
      step("job started");
      await done;
    })()]);
    step(`finished after ${toolCalls} tool call${toolCalls === 1 ? "" : "s"}`);
    const text = lastText.trim() || "Codex finished without a final message.";
    return { content: [{ type: "text", text: `${text.length > ANSWER_LIMIT ? `${text.slice(0, ANSWER_LIMIT)}\n[cut]` : text}${toolCalls ? `\n\n(Codex made ${toolCalls} tool call${toolCalls === 1 ? "" : "s"} on this computer.)` : ""}` }] };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", aborted);
    child.removeAllListeners("exit");
    child.on("exit", () => {});
    const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((resolve) => child.once("exit", resolve));
    stopTree(child);
    // Windows refuses to delete a folder a running process works in.
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000).unref())]);
    await fs.rm(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
  }
}
