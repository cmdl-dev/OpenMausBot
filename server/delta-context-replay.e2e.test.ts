import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { count, cursor, fixture, leadRunning, sourceWaiting, warmUp } from "./testing/delta-context-fixture.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

it("gives a replacement session the full assignment when a result returns after its resume was rejected", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "REPLACED_RESULT", gateFile: f.gate("lead") };
  f.plan[f.chief.id] = { turns: [{}, f.delegate("build", [f.lead], `BRIEF_START ${"b".repeat(800)} BRIEF_END`), { reply: "4" }, { reply: "Reviewed" }] };
  await f.send("Please have Engineering build the export.");
  await leadRunning(f);
  const original = cursor(f);
  await f.setMode("resume=dead-session");
  await f.send("Meanwhile, what is 2+2?");
  await expect.poll(() => f.turns().length, { timeout: 20_000 }).toBe(3);
  await expect.poll(async () => (await f.messages()).some((m: any) => m.role === "bot" && m.text === "4"), { timeout: 10_000 }).toBe(true);
  await f.setMode();
  await expect.poll(() => cursor(f), { timeout: 15_000 }).toBeTruthy();
  await expect.poll(() => cursor(f), { timeout: 15_000 }).not.toBe(original);
  const replacement = cursor(f);
  f.open(f.gate("lead"));
  await f.wait();

  const recovery = f.prompt(f.turns()[2]);
  const returned = f.prompt(f.turns().at(-1));
  expect(recovery).toContain("could not be resumed");
  expect(replacement).not.toBe(original);
  expect(f.launches().at(-1).resume).toBe(replacement);
  expect(count(recovery + returned, "REPLACED_RESULT")).toBe(1);
  const lead = f.nodes().find((node: any) => node.botId === f.lead.id);
  expect(returned).toContain(`[From @${f.lead.name} (bot) · report on assignment ${lead.id}: done · information only]`);
}), hostTimeout(90_000));

it("gives a replacement session an earlier round's result that its rebuild could not replay, and credits it only with that rebuild", () => fixture(async (f) => {
  await warmUp(f, "Warm up.");
  const chat = 21;
  f.plan[f.lead.id] = { turns: [{ reply: "ROUND_ONE_RESULT_TOKEN" }, { reply: "ROUND_TWO_RESULT", gateFile: f.gate("r2") }] };
  f.plan[f.chief.id] = { turns: [
    {},
    f.delegate("r1", [f.lead], "REQUEST_ONE build it"),
    { steps: [{ arguments: { bot_ids: [f.lead.id], request_key: "r2", message: "REQUEST_TWO also test it", rework: true } }], reply: "Round two sent" },
    ...Array.from({ length: chat }, (_, i) => ({ reply: `chat reply ${i}` })),
    { reply: "recovered reply" },
    { reply: "Final" },
  ] };
  await f.send("Please have Engineering build and then test it.");
  await expect.poll(() => f.nodes().filter((node: any) => node.botId === f.lead.id).map((node: any) => node.status).join(","), { timeout: 30_000 }).toBe("completed,running");
  await expect.poll(() => f.turns().length, { timeout: 10_000 }).toBe(3);
  await expect.poll(() => count(f.prompt(f.turns()[2]), "ROUND_ONE_RESULT_TOKEN"), { timeout: 10_000 }).toBe(1);
  await expect.poll(() => f.consumed(f.lead.id), { timeout: 15_000 }).toBe(2);
  for (let i = 0; i < chat; i++) {
    await sourceWaiting(f);
    expect((await f.send(`chat ${i}`)).steered).toBeUndefined();
    await expect.poll(() => f.turns().length, { timeout: 20_000 }).toBe(4 + i);
    await expect.poll(async () => (await f.messages()).some((m: any) => m.text === `chat reply ${i}` && m.turnTerminal), { timeout: 10_000 }).toBe(true);
  }
  const history = async () => (await f.api(`/api/threads/${f.thread}/messages?limit=200`)).messages.map((m: any) => m.id);
  const resultMessage = (await f.api(`/api/threads/${f.thread}/messages?limit=200`)).messages.find((m: any) => m.roomRequest?.phase === "result");
  const original = cursor(f);
  await f.setMode("resume=dead-session");
  await expect.poll(async () => (await f.messages()).some((m: any) => m.text === `chat reply ${chat - 1}` && m.turnTerminal), { timeout: 10_000 }).toBe(true);
  await sourceWaiting(f);
  expect((await f.send("One more question.")).steered).toBeUndefined();
  await expect.poll(() => f.turns().length, { timeout: 20_000 }).toBe(4 + chat);
  await expect.poll(async () => (await f.messages()).some((m: any) => m.text === "recovered reply"), { timeout: 10_000 }).toBe(true);
  await f.setMode();
  const recovery = f.prompt(f.turns().at(-1));
  expect(recovery).toContain("could not be resumed");
  expect(count(recovery, "ROUND_ONE_RESULT_TOKEN")).toBe(0);

  const replacement = cursor(f);
  expect(replacement).not.toBe(original);
  const records = Object.values(f.handed()) as any[];
  expect(records).toHaveLength(1);
  expect(records[0].session).toBe(replacement);
  const order = await history();
  expect(records[0].ids).not.toContain(resultMessage.id);
  expect(order.indexOf(records[0].omitted)).toBeGreaterThanOrEqual(order.indexOf(resultMessage.id));

  await sourceWaiting(f);
  f.open(f.gate("r2"));
  await expect.poll(() => f.turns().length, { timeout: 30_000 }).toBe(5 + chat);
  await expect.poll(async () => (await f.messages()).some((m: any) => m.text === "Final" && m.turnTerminal), { timeout: 15_000 }).toBe(true);
  await f.wait();
  const returned = f.prompt(f.turns().at(-1));
  expect(count(returned, "ROUND_TWO_RESULT")).toBe(1);
  expect(count(returned, "ROUND_ONE_RESULT_TOKEN")).toBe(1);
  expect(returned).not.toContain("already delivered");
}), hostTimeout(240_000));

it("does not send a message again that a recovery replay carried, including one the unseen limit had deferred", () => fixture(async (f) => {
  await warmUp(f);
  await f.setMode("exit-early");
  const marks = Array.from({ length: 13 }, (_, i) => `DEFERRED_${String(i).padStart(2, "0")}_MARK`);
  for (const [i, mark] of marks.entries()) {
    expect((await f.send(`${mark} please note this`)).steered).toBeUndefined();
    await expect.poll(() => f.launches().length, { timeout: 15_000 }).toBe(3 + 2 * i);
    await f.idle();
  }
  await f.setMode("resume=dead-session");
  f.plan[f.chief.id] = { reply: "Rebuilt" };
  await f.send("Recover now.");
  await f.wait();
  await f.setMode();
  const recovery = f.prompt(f.turns().at(-1));
  expect(recovery).toContain("could not be resumed");
  for (const mark of marks) expect(count(recovery, mark), mark).toBe(1);

  f.plan[f.chief.id] = { reply: "Nothing to repeat" };
  await f.send("Anything left?");
  await f.wait();
  const next = f.prompt(f.turns().at(-1));
  expect(f.launches().at(-1).resume).toBe(cursor(f));
  for (const mark of marks) expect(count(next, mark), mark).toBe(0);
  expect(next).not.toContain("not seen yet");
}), hostTimeout(120_000));

it("replays again when a replacement session fails before the provider acts on it", () => fixture(async (f) => {
  await warmUp(f);
  await f.setMode("resume=dead-session,fresh=api-error");
  await f.send("REPLACEMENT_FAILS please answer this");
  await expect.poll(() => f.launches().length, { timeout: 15_000 }).toBe(3);
  await f.idle();
  await f.setMode();
  f.plan[f.chief.id] = { reply: "Answered" };
  await f.send("Try again.");
  await f.wait();
  const next = f.prompt(f.turns().at(-1));
  expect(f.launches().at(-1).resume).toBeNull();
  expect(next).toContain("ORCHID_7Q");
  expect(count(next, "REPLACEMENT_FAILS")).toBe(1);
}), hostTimeout(60_000));

it("gives an engine switched in while a teammate works the full assignment when the result returns", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "SWITCH_RESULT", gateFile: f.gate("lead") };
  f.plan[f.chief.id] = { turns: [{}, f.delegate("build", [f.lead], `ASSIGNMENT_START ${"a".repeat(400)} MUST_KEEP_CONSTRAINT`), { reply: "On Codex now" }, { reply: "Reviewed on Codex" }] };
  await f.send("Please have Engineering build the export.");
  await leadRunning(f);
  await expect.poll(async () => (await f.messages()).some((m: any) => m.role === "bot" && m.text === "Assigned"), { timeout: 15_000 }).toBe(true);
  const model = (await f.cli("models")).instances.find((item: any) => item.instanceId === "codex").models.options[0].id;
  await f.api(`/api/bots/${f.chief.id}/tasks/${f.thread}`, { modelSelection: { instanceId: "codex", model }, requireAvailableModel: true }, "PATCH");
  await f.send("Switching engines while Engineering works.");
  await expect.poll(() => f.turns().length, { timeout: 20_000 }).toBe(3);
  await expect.poll(async () => (await f.messages()).some((m: any) => m.role === "bot" && m.text === "On Codex now"), { timeout: 10_000 }).toBe(true);
  f.open(f.gate("lead"));
  await f.wait();
  const returned = f.turns().at(-1);
  expect(returned.resumedThread).toBeTruthy();
  expect(count(f.prompt(returned), "SWITCH_RESULT")).toBe(1);
  const lead = f.nodes().find((node: any) => node.botId === f.lead.id);
  expect(f.prompt(returned)).toContain(`[From @${f.lead.name} (bot) · report on assignment ${lead.id}: done · information only]`);
}, { codex: {} }), hostTimeout(90_000));

it("does not offer a message or steer the person stopped before any reply again", () => fixture(async (f) => {
  f.plan[f.chief.id] = { turns: [{ reply: "Noted." }, { readyFile: f.gate("slow-ready"), reply: "never shown", gateFile: f.gate("slow") }, { reply: "Listed" }] };
  await f.send("Warm up.");
  await f.wait();
  await f.send("STOPPED_ASK please drop the staging database");
  await expect.poll(() => existsSync(f.gate("slow-ready")), { timeout: 15_000 }).toBe(true);
  expect((await f.send("STOPPED_STEER and the backups")).steered).toBe(true);
  await f.api(`/api/bots/${f.chief.id}/interrupt`, { threadId: f.thread });
  await f.idle();
  f.open(f.gate("slow"));
  await f.send("Actually, just list the tables.");
  await f.wait();
  const next = f.prompt(f.turns().at(-1));
  expect(f.launches().at(-1).resume).not.toBeNull();
  expect(next).not.toContain("STOPPED_ASK");
  expect(next).not.toContain("STOPPED_STEER");
}), hostTimeout(60_000));

it("does not offer a message the person stopped before any reply again on Codex", () => fixture(async (f) => {
  await f.useModel("codex");
  f.plan[f.chief.id] = { turns: [{ reply: "Noted." }, { reply: "never shown", gateFile: f.gate("slow") }, { reply: "Listed" }] };
  await f.send("Warm up.");
  await f.wait();
  await f.send("CODEX_STOPPED_ASK please drop the staging database");
  await expect.poll(() => f.codexLaunches().length, { timeout: 15_000 }).toBe(2);
  await f.api(`/api/bots/${f.chief.id}/interrupt`, { threadId: f.thread });
  await f.idle();
  f.open(f.gate("slow"));
  await f.send("Actually, just list the tables.");
  await f.wait();
  const next = f.turns().at(-1);
  expect(next.resumedThread).toBeTruthy();
  expect(f.prompt(next)).not.toContain("CODEX_STOPPED_ASK");
}, { codex: {} }), hostTimeout(90_000));

it("offers a steered message again when the turn fails before the provider used it", () => fixture(async (f) => {
  f.plan[f.chief.id] = { turns: [{ reply: "Noted." }, { progress: "Looking into it", gateFile: f.gate("turn"), fail: true }, { reply: "Covered" }] };
  await f.send("Warm up.");
  await f.wait();
  await f.send("Start on the report.");
  await expect.poll(async () => (await f.messages()).some((m: any) => m.role === "bot" && m.text === "Looking into it"), { timeout: 15_000 }).toBe(true);
  expect((await f.send("UNUSED_STEER also cover costs")).steered).toBe(true);
  f.open(f.gate("turn"));
  await f.idle();
  await f.send("Is it done?");
  await f.wait();
  const next = f.prompt(f.turns().at(-1));
  expect(count(next, "UNUSED_STEER")).toBe(1);
  expect(next).not.toContain("Start on the report.");
}), hostTimeout(60_000));

it("does not offer a steered message again after the person stops the turn it went into", () => fixture(async (f) => {
  f.plan[f.chief.id] = { turns: [{ reply: "Noted." }, { progress: "Looking into it", reply: "never shown", gateFile: f.gate("turn") }, { reply: "Covered" }] };
  await f.send("Warm up.");
  await f.wait();
  await f.send("Start on the report.");
  await expect.poll(async () => (await f.messages()).some((m: any) => m.role === "bot" && m.text === "Looking into it"), { timeout: 15_000 }).toBe(true);
  expect((await f.send("STOPPED_TURN_STEER also cover costs")).steered).toBe(true);
  await f.api(`/api/bots/${f.chief.id}/interrupt`, { threadId: f.thread });
  await f.idle();
  f.open(f.gate("turn"));
  await f.send("Is it done?");
  await f.wait();
  expect(f.prompt(f.turns().at(-1))).not.toContain("STOPPED_TURN_STEER");
}), hostTimeout(60_000));

it("does not offer a message again that the person steered out of the queue into a turn they then stopped", () => {
  const refuseLiveSteers = join(tmpdir(), `omb-queue-steer-${process.pid}-${Date.now()}.gate`);
  writeFileSync(refuseLiveSteers, "refuse live steers until the queue is lifted");
  return fixture(async (f) => {
    await f.useModel("codex");
    f.plan[f.chief.id] = { turns: [{ reply: "Noted." }, { readyFile: f.gate("slow-ready"), reply: "never shown", gateFile: f.gate("slow") }, { reply: "Listed" }] };
    await f.send("Warm up.");
    await f.wait();
    await f.send("Start on the report.");
    await expect.poll(() => existsSync(f.gate("slow-ready")), { timeout: 15_000 }).toBe(true);
    // The engine refuses the live steer, so the words wait in the queue.
    const queued = await f.send("QUEUED_STEER also cover costs");
    expect(queued.queued).toBe(true);
    rmSync(refuseLiveSteers, { force: true });
    // A refused steer restores the queue untouched, so ask again until the engine is far enough into the turn.
    await expect.poll(async () =>
      (await f.api(`/api/bots/${f.chief.id}/queue/${queued.queueId}/steer`, { threadId: f.thread })).steered,
    { timeout: 20_000 }).toBe(true);
    await f.api(`/api/bots/${f.chief.id}/interrupt`, { threadId: f.thread });
    await f.idle();
    f.open(f.gate("slow"));
    await f.send("Is it done?");
    await f.wait();
    expect(f.prompt(f.turns().at(-1))).not.toContain("QUEUED_STEER");
  }, { codex: { FAKE_CODEX_STEER_ERROR_FILE: refuseLiveSteers } });
}, hostTimeout(90_000));

it("offers the results again when the provider reports an API error instead of answering", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "API_ERROR_RESULT", gateFile: f.gate("lead") };
  f.plan[f.chief.id] = { turns: [{}, f.delegate("build", [f.lead], "Build the export"), { reply: "Here is what Engineering found" }] };
  await f.send("Please have Engineering build the export.");
  await leadRunning(f);
  await expect.poll(async () => (await f.messages()).some((m: any) => m.role === "bot" && m.text === "Assigned"), { timeout: 15_000 }).toBe(true);
  await f.setMode("api-error");
  f.open(f.gate("lead"));
  await expect.poll(() => f.root()?.status, { timeout: 20_000 }).toBe("failed");
  await f.idle();
  await f.setMode();
  await f.send("What did Engineering find?");
  await f.wait();
  expect(count(f.prompt(f.turns().at(-1)), "API_ERROR_RESULT")).toBe(1);
}), hostTimeout(60_000));

it("does not hand the model a queued follow-up that a restart recovered with an unknown outcome", () => fixture(async (f) => {
  await f.api("/api/config", { threads: { maxConcurrentPerBot: 1 } }, "PATCH");
  const other = (await f.api(`/api/bots/${f.chief.id}/tasks`, { title: "Second conversation" })).task.threadId;
  f.plan[f.chief.id] = { turns: [{ reply: "Noted." }, { readyFile: f.gate("hold-ready"), reply: "Held", gateFile: f.gate("hold") }, { reply: "never", gateFile: f.gate("never") }] };
  await f.send("Warm up.", other);
  await f.wait(other);
  await f.send("Hold the only slot.");
  await expect.poll(() => existsSync(f.gate("hold-ready")), { timeout: 15_000 }).toBe(true);
  expect((await f.send("RECOVERED_FOLLOWUP deploy it", other)).queued).toBe(true);
  f.open(f.gate("hold"));
  await expect.poll(() => f.consumed(), { timeout: 15_000 }).toBe(3);
  const interruptedPid = f.launches().at(-1).pid;
  await f.restart(() => {}, "SIGKILL");
  await expect.poll(() => {
    try { process.kill(interruptedPid, 0); return true; } catch { return false; }
  }, { timeout: 5_000 }).toBe(false);
  await expect.poll(async () => (await f.messages(other)).some((m: any) => m.kind === "activity" && m.tool?.name?.includes("Review the result")), { timeout: 20_000 }).toBe(true);
  expect((await f.messages(other)).filter((m: any) => m.role === "user" && m.text?.includes("RECOVERED_FOLLOWUP"))).toHaveLength(1);

  // The crashed turn never completes its evidence record, so the next reply is named explicitly.
  f.plan[f.chief.id] = { reply: "Answered" };
  await f.send("Anything new?", other);
  await f.wait(other);
  const next = f.turns().filter((turn: any) => f.prompt(turn).includes("Anything new?")).at(-1);
  expect(next).toBeDefined();
  expect(f.launches().at(-1).resume).not.toBeNull();
  expect(f.prompt(next)).not.toContain("RECOVERED_FOLLOWUP");
}), hostTimeout(90_000));
