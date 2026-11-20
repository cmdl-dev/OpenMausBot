import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { expect, it } from "vitest";

import { count, fixture, leadRunning, sourceWaiting, warmUp } from "./testing/delta-context-fixture.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { withoutTurnClock } from "./testing/turn-clock-text.ts";

it("gives a delegated return the fresh session and replay it always had when the bot's soul changed while teammates worked", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "SOUL_CHANGE_RESULT", gateFile: f.gate("lead") };
  f.plan[f.chief.id] = { turns: [{}, f.delegate("build", [f.lead], "Build the export"), { reply: "Reviewed in German" }, { reply: "Still German" }] };
  await f.send("Please have Engineering build the export.");
  await leadRunning(f);
  await expect.poll(async () => (await f.messages()).some((m: any) => m.role === "bot" && m.text === "Assigned"), { timeout: 15_000 }).toBe(true);
  await f.api(`/api/bots/${f.chief.id}`, { soul: "NEW_SOUL_MARK Always answer in German." }, "PATCH");
  f.open(f.gate("lead"));
  await f.wait();

  const returned = f.turns().at(-1);
  expect(f.launches().at(-1).resume).toBeNull();
  const replacement = f.nativeSession();
  expect(returned.system).toContain("NEW_SOUL_MARK");
  expect(f.prompt(returned)).toContain("received an update outside your provider session");
  expect(f.prompt(returned)).toContain("ORCHID_7Q");
  expect(count(f.prompt(returned), "SOUL_CHANGE_RESULT")).toBe(1);

  await f.send("And now?");
  await f.wait();
  expect(f.nativeSession()).toBe(replacement);
  expect(count(f.prompt(f.turns().at(-1)), "SOUL_CHANGE_RESULT")).toBe(0);
}), hostTimeout(90_000));

it("keeps resuming an ordinary turn after a soul change, as before", () => fixture(async (f) => {
  await warmUp(f);
  await f.api(`/api/bots/${f.chief.id}`, { soul: "NEW_SOUL_MARK Always answer in German." }, "PATCH");
  f.plan[f.chief.id] = { reply: "Noted again." };
  await f.send("Second message.");
  await f.wait();
  expect(f.launches().at(-1).resume).not.toBeNull();
  expect(withoutTurnClock(f.prompt(f.turns().at(-1)))).toBe("Second message.");
}), hostTimeout(60_000));

it("offers a steer written into a resume the provider then rejected on the next turn", () => fixture(async (f) => {
  await warmUp(f);
  await f.setMode("resume=dead-session,holdresume=1");
  f.plan[f.chief.id] = { reply: "Four." };
  await f.send("QUESTION_ONE what is 2+2?");
  await expect.poll(() => f.launches().length, { timeout: 15_000 }).toBe(2);
  expect((await f.send("LOST_STEER_MARK and also mention the backups")).steered).toBe(true);
  f.open(f.gate("resume-hold"));
  await f.wait();
  await f.setMode();
  expect(count(f.prompt(f.turns().at(-1)), "LOST_STEER_MARK")).toBe(0);

  f.plan[f.chief.id] = { reply: "Nothing else." };
  await f.send("NEXT_Q anything else?");
  await f.wait();
  expect(f.launches().at(-1).resume).not.toBeNull();
  expect(count(f.prompt(f.turns().at(-1)), "LOST_STEER_MARK")).toBe(1);
}), hostTimeout(90_000));

it("offers a steered message again when only output of the model call already running follows it before the turn fails", () => fixture(async (f) => {
  f.plan[f.chief.id] = { turns: [
    { reply: "Noted." },
    { progress: "Looking into it", gateFile: f.gate("turn"), progressAfterGate: "Still answering the first question", fail: true },
    { reply: "Covered" },
  ] };
  await f.send("Warm up.");
  await f.wait();
  await f.send("Start on the report.");
  await expect.poll(async () => (await f.messages()).some((m: any) => m.role === "bot" && m.text === "Looking into it"), { timeout: 15_000 }).toBe(true);
  expect((await f.send("BUFFERED_STEER also cover costs")).steered).toBe(true);
  f.open(f.gate("turn"));
  await expect.poll(async () => (await f.messages()).some((m: any) => m.role === "bot" && m.text === "Still answering the first question"), { timeout: 15_000 }).toBe(true);
  await f.idle();
  await f.send("Is it done?");
  await f.wait();
  expect(count(f.prompt(f.turns().at(-1)), "BUFFERED_STEER")).toBe(1);
}), hostTimeout(60_000));

it("rebuilds a delegated return whose Codex thread is gone into a new thread with today's replay", () => fixture(async (f) => {
  await f.useModel("codex");
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "MISSING_THREAD_RESULT", gateFile: f.gate("lead") };
  f.plan[f.chief.id] = { turns: [{}, f.delegate("build", [f.lead], "Build the export"), { reply: "Rebuilt on Codex" }, { reply: "Still on Codex" }] };
  await f.send("Please have Engineering build the export.");
  await leadRunning(f);
  await expect.poll(async () => (await f.messages()).some((m: any) => m.role === "bot" && m.text === "Assigned"), { timeout: 15_000 }).toBe(true);
  // The personal (unmanaged) Codex app-server no longer has the thread.
  await f.setMode("happy", "codex");
  f.open(f.gate("lead"));
  await f.wait();
  await f.setMode(undefined, "codex");

  expect(f.root().status).toBe("completed");
  const returned = f.prompt(f.turns().at(-1));
  expect(returned).toContain("received an update outside your provider session");
  expect(returned).toContain("ORCHID_7Q");
  expect(count(returned, "MISSING_THREAD_RESULT")).toBe(1);

  await f.send("And now?");
  await f.wait();
  const next = f.turns().at(-1);
  expect(next.resumedThread).toBeTruthy();
  expect(count(f.prompt(next), "MISSING_THREAD_RESULT")).toBe(0);
}, { codex: {} }), hostTimeout(90_000));

it("replays a result that reaches an engine switched in before it arrived with today's update preamble", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "EARLY_SWITCH_RESULT", gateFile: f.gate("lead") };
  f.plan[f.chief.id] = { turns: [{}, f.delegate("build", [f.lead], "Build the export"), { reply: "Reviewed on Codex" }] };
  await f.send("Please have Engineering build the export.");
  await leadRunning(f);
  await expect.poll(async () => (await f.messages()).some((m: any) => m.role === "bot" && m.text === "Assigned"), { timeout: 15_000 }).toBe(true);
  const model = (await f.cli("models")).instances.find((item: any) => item.instanceId === "codex").models.options[0].id;
  await f.api(`/api/bots/${f.chief.id}/tasks/${f.thread}`, { modelSelection: { instanceId: "codex", model }, requireAvailableModel: true }, "PATCH");
  f.open(f.gate("lead"));
  await f.wait();
  const returned = f.prompt(f.turns().at(-1));
  expect(returned).toContain("received an update outside your provider session");
  expect(returned).not.toContain("switched this bot over to you");
  expect(returned).toContain("ORCHID_7Q");
  expect(count(returned, "EARLY_SWITCH_RESULT")).toBe(1);
}, { codex: {} }), hostTimeout(90_000));

// A `git` on PATH that holds its first command while `hold` exists, so a turn's checkpoint waits inside turn setup.
const holdingGit = (dataDir: string, hold: string, held: string) => {
  const real = (process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, "git")).find((path) => existsSync(path));
  if (!real) throw new Error("this test needs git on PATH");
  const bin = join(dataDir, "fake-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "git"), [
    "#!/usr/bin/env node",
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { spawnSync } from "node:child_process";',
    "const args = process.argv.slice(2);",
    `if (args[0] !== "--version" && existsSync(${JSON.stringify(hold)})) {`,
    `  writeFileSync(${JSON.stringify(held)}, "held");`,
    `  while (existsSync(${JSON.stringify(hold)})) await new Promise((r) => setTimeout(r, 20));`,
    "}",
    `process.exit(spawnSync(${JSON.stringify(real)}, args, { stdio: "inherit" }).status ?? 1);`,
  ].join("\n"), { mode: 0o700 });
  return bin;
};

// POSIX only: the holding `git` is a node shebang script, and on Windows git is git.exe and a shebang file is not executable.
it.skipIf(process.platform === "win32")("gives a delegated return today's fresh session and replay when the soul changes while that turn is being set up", () => fixture(async (f) => {
  const project = join(f.dataDir, "project");
  mkdirSync(project);
  await f.api(`/api/bots/${f.chief.id}`, { cwd: project }, "PATCH");
  const hold = join(f.dataDir, "git.hold");
  const held = join(f.dataDir, "git.held");
  await f.restart(() => {}, "SIGTERM", { PATH: [holdingGit(f.dataDir, hold, held), dirname(process.execPath)].join(delimiter) });
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "SETUP_SOUL_RESULT", gateFile: f.gate("lead") };
  f.plan[f.chief.id] = { turns: [{}, f.delegate("build", [f.lead], "Build the export"), { reply: "Reviewed" }] };
  await f.send("Please have Engineering build the export.");
  await leadRunning(f);
  await expect.poll(async () => (await f.messages()).some((m: any) => m.role === "bot" && m.text === "Assigned"), { timeout: 15_000 }).toBe(true);
  writeFileSync(hold, "hold");
  f.open(f.gate("lead"));
  await expect.poll(() => existsSync(held), { timeout: 20_000 }).toBe(true);
  await f.api(`/api/bots/${f.chief.id}`, { soul: "SETUP_SOUL_MARK Always answer in German." }, "PATCH");
  rmSync(hold);
  await f.wait();

  const returned = f.turns().at(-1);
  expect(returned.system).toContain("SETUP_SOUL_MARK");
  expect(f.launches().at(-1).resume).toBeNull();
  expect(f.prompt(returned)).toContain("received an update outside your provider session");
  expect(count(f.prompt(returned), "SETUP_SOUL_RESULT")).toBe(1);
  const record = Object.values(f.handed())[0] as any;
  expect(record.session).toBe(Object.values(f.task().resumeCursors)[0]);
  expect(record.omitted).toBeUndefined();
  expect(record.through).toBeTruthy();

  f.plan[f.chief.id] = { reply: "Nothing new" };
  await f.send("And now?");
  await f.wait();
  expect(f.nativeSession()).toBe(Object.values(f.task().resumeCursors)[0]);
  expect(count(f.prompt(f.turns().at(-1)), "SETUP_SOUL_RESULT")).toBe(0);
}), hostTimeout(90_000));

it("gives a Codex return the model chosen while its teammate worked", () => fixture(async (f) => {
  await f.useModel("codex");
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "CODEX_MODEL_RESULT", gateFile: f.gate("lead") };
  f.plan[f.chief.id] = { turns: [{}, f.delegate("build", [f.lead], "Build the export"), { reply: "Reviewed on the new model" }] };
  await f.send("Please have Engineering build the export.");
  await leadRunning(f);
  await expect.poll(async () => (await f.messages()).some((m: any) => m.role === "bot" && m.text === "Assigned"), { timeout: 15_000 }).toBe(true);
  await sourceWaiting(f);
  // Codex applies a model only when a thread starts: thread/resume would keep the old one.
  const [, other] = await f.codexModels();
  await f.selectModel(other);
  f.open(f.gate("lead"));
  await f.wait();

  const started = f.codexCalls().filter((call: any) => call.method === "thread/start");
  expect(started).toHaveLength(1);
  expect(started[0].params.model).toBe(other);
  const returned = f.prompt(f.turns().at(-1));
  expect(returned).toContain("received an update outside your provider session");
  expect(count(returned, "CODEX_MODEL_RESULT")).toBe(1);
}, { codex: {} }), hostTimeout(90_000));

it("gives a Codex return today's fresh thread when explicit effort is cleared while its teammate worked", () => fixture(async (f) => {
  await f.useModel("codex");
  const [model] = await f.codexModels();
  await f.selectModel(model, { effort: "high" });
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "CODEX_EFFORT_RESULT", gateFile: f.gate("lead") };
  f.plan[f.chief.id] = { turns: [{}, f.delegate("build", [f.lead], "Build the export"), { reply: "Reviewed on default effort" }] };
  await f.send("Please have Engineering build the export.");
  await leadRunning(f);
  await expect.poll(async () => (await f.messages()).some((m: any) => m.role === "bot" && m.text === "Assigned"), { timeout: 15_000 }).toBe(true);
  await sourceWaiting(f);
  // An effort the driver does not send leaves the native thread's last value.
  await f.selectModel(model);
  f.open(f.gate("lead"));
  await f.wait();

  expect(f.codexCalls().filter((call: any) => call.method === "thread/start")).toHaveLength(1);
  expect(f.codexCalls().find((call: any) => call.method === "turn/start")?.params.effort).toBeUndefined();
  expect(count(f.prompt(f.turns().at(-1)), "CODEX_EFFORT_RESULT")).toBe(1);
}, { codex: {} }), hostTimeout(90_000));

it("moves a Codex chat to a new thread with its history when the person clears an effort its thread holds", () => fixture(async (f) => {
  await f.useModel("codex");
  const [model] = await f.codexModels();
  await f.selectModel(model);
  await warmUp(f);
  await f.selectModel(model, { effort: "high" });
  f.plan[f.chief.id] = { reply: "On high effort" };
  await f.send("Think harder about this one.");
  await f.wait();
  expect(f.codexCalls().filter((call: any) => call.method === "thread/resume")).toHaveLength(1);
  expect(f.codexCalls().find((call: any) => call.method === "turn/start")?.params.effort).toBe("high");

  // turn/start cannot clear it: resuming would keep the thread on "high".
  await f.selectModel(model);
  f.plan[f.chief.id] = { reply: "On default effort" };
  await f.send("What is the codename?");
  await f.wait();
  expect(f.codexCalls().filter((call: any) => call.method === "thread/resume")).toHaveLength(0);
  expect(f.codexCalls().filter((call: any) => call.method === "thread/start")).toHaveLength(1);
  expect(f.codexCalls().find((call: any) => call.method === "turn/start")?.params.effort).toBeUndefined();
  expect(count(f.prompt(f.turns().at(-1)), "ORCHID_7Q")).toBe(1);

  f.plan[f.chief.id] = { reply: "Still on default effort" };
  await f.send("And now?");
  await f.wait();
  const next = f.turns().at(-1);
  expect(next.resumedThread).toBeTruthy();
  expect(f.prompt(next)).not.toContain("ORCHID_7Q");
}, { codex: {} }), hostTimeout(90_000));

it("keeps today's fresh return on a Claude CLI that cannot refresh a resumed system prompt", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "OLD_CLI_RESULT", gateFile: f.gate("lead") };
  f.plan[f.chief.id] = { turns: [{}, f.delegate("build", [f.lead], "Build the export"), { reply: "Reviewed" }] };
  await f.send("Please have Engineering build the export.");
  await leadRunning(f);
  f.open(f.gate("lead"));
  await f.wait();

  expect(f.launches().at(-1).resume).toBeNull();
  const returned = f.prompt(f.turns().at(-1));
  expect(returned).toContain("received an update outside your provider session");
  expect(returned).toContain("ORCHID_7Q");
  expect(count(returned, "OLD_CLI_RESULT")).toBe(1);
  expect(f.handed()).toBeUndefined();
}, { env: { FAKE_CLAUDE_VERSION: "2.1.200" } }), hostTimeout(90_000));
