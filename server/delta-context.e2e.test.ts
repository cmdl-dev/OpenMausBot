import { existsSync } from "node:fs";
import { expect, it } from "vitest";

import { UNSEEN_END } from "./delta-context.ts";
import { count, fixture, leadRunning, sourceWaiting, warmUp } from "./testing/delta-context-fixture.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

it("resumes the source session and gives it each of three results exactly once, with a long brief", () => fixture(async (f) => {
  await warmUp(f);
  for (const [bot, tag] of [[f.lead, "LEAD"], [f.qa, "QA"], [f.ops, "OPS"]] as const) {
    f.plan[bot.id] = { reply: `RESULT_${tag}_START ${"r".repeat(1_200)} RESULT_${tag}_END` };
  }
  f.plan[f.chief.id] = f.delegate("fanout", [f.lead, f.qa, f.ops], `BRIEF_START ${"b".repeat(1_500)} BRIEF_END`);
  await f.send("Have Engineering, QA and Ops each check the release.");
  await f.wait();

  const returned = f.turns().at(-1);
  const text = f.prompt(returned);
  expect(returned.resumed).toBe(true);
  expect(f.nativeSession()).toBe(f.launches()[0].sessionId);
  for (const tag of ["LEAD", "QA", "OPS"]) {
    expect(count(text, `RESULT_${tag}_START`)).toBe(1);
    expect(count(text, `RESULT_${tag}_END`)).toBe(1);
  }
  expect(text).not.toContain("ORCHID_7Q");
  expect(text).not.toMatch(/^Assistant: @/m);
}), hostTimeout(60_000));

it("keeps the source's and the teammate's engines through reports and the person's next messages", () => fixture(async (f) => {
  await warmUp(f);
  for (const round of [1, 2]) {
    f.plan[f.lead.id] = { reply: `ROUND_${round}_RESULT` };
    f.plan[f.chief.id] = f.delegate(`round-${round}`, [f.lead], `Check round ${round}`);
    await f.send(`Have Engineering check round ${round}.`);
    await f.wait();
    expect(count(f.prompt(f.turns().at(-1)), `ROUND_${round}_RESULT`)).toBe(1);
  }
  f.plan[f.chief.id] = { reply: "Plain answer." };
  await f.send("Just a plain question now.");
  await f.wait();

  expect(f.launches()).toHaveLength(1);
  expect(f.launches(f.lead.id)).toHaveLength(1);
  expect(f.consumed()).toBe(6);
  expect(f.consumed(f.lead.id)).toBe(2);
  expect(f.prompt(f.turns().at(-1))).not.toMatch(/ROUND_\d_RESULT/);
}), hostTimeout(90_000));

it("keeps an ACP teammate's session through two hand-offs", () => fixture(async (f) => {
  await f.api(`/api/bots/${f.lead.id}`, { modelSelection: { instanceId: "myAgent", model: "fixture-fast" } }, "PATCH");
  await warmUp(f);
  for (const round of [1, 2]) {
    f.plan[f.chief.id] = f.delegate(`round-${round}`, [f.lead], `Check round ${round}`);
    await f.send(`Have Engineering check round ${round}.`);
    await f.wait();
  }
  const sessions = f.acpCalls().filter((call: any) => ["session/new", "session/load", "session/prompt"].includes(call.method));
  expect(sessions.map((call: any) => call.method)).toEqual(["session/new", "session/prompt", "session/prompt"]);
  expect(new Set(sessions.map((call: any) => call.pid)).size).toBe(1);
}, { acp: true }), hostTimeout(90_000));

it("gives the return turn a result that landed while a newer message was running, exactly once", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "LEAD_RESULT_TOKEN", gateFile: f.gate("lead") };
  f.plan[f.chief.id] = { turns: [{}, f.delegate("build", [f.lead], "Build the export"), { reply: "4", gateFile: f.gate("steer") }, { reply: "Done" }] };
  await f.send("Please have Engineering build the export.");
  await expect.poll(() => f.nodes().find((node: any) => node.botId === f.lead.id)?.status, { timeout: 15_000 }).toBe("running");
  expect((await f.send("Meanwhile, what is 2+2?")).queued).toBeUndefined();
  f.open(f.gate("lead"));
  await expect.poll(async () => (await f.messages()).some((m: any) => m.tool?.name === "Engineering lead replied"), { timeout: 20_000 }).toBe(true);
  f.open(f.gate("steer"));
  await f.wait();

  const returned = f.turns().at(-1);
  expect(returned.resumed).toBe(true);
  expect(count(f.prompt(returned), "LEAD_RESULT_TOKEN")).toBe(1);
  expect(f.nativeSession()).toBe(f.launches()[0].sessionId);
}), hostTimeout(60_000));

it("stops the teammate with the source it worked for, so no result of it lands later or reaches a later turn", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "STOPPED_SOURCE_RESULT", gateFile: f.gate("lead") };
  f.plan[f.chief.id] = f.delegate("build", [f.lead], "Build the export");
  await f.send("Please have Engineering build the export.");
  await expect.poll(() => f.nodes().find((node: any) => node.botId === f.lead.id)?.status, { timeout: 15_000 }).toBe("running");
  await f.api(`/api/bots/${f.chief.id}/interrupt`, { threadId: f.thread });
  await f.wait();
  await expect.poll(() => f.nodes().find((node: any) => node.botId === f.lead.id)?.status, { timeout: 15_000 }).toBe("cancelled");
  f.open(f.gate("lead"));

  f.plan[f.chief.id] = { reply: "Engineering was stopped" };
  await f.send("What did Engineering report?");
  await f.wait();
  expect((await f.messages()).some((m: any) => m.tool?.name === "Engineering lead replied")).toBe(false);
  expect(count(f.prompt(f.turns().at(-1)), "STOPPED_SOURCE_RESULT")).toBe(0);
}), hostTimeout(90_000));

it("offers a message steered into a running turn to the next turn once, marked as possibly already seen", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.chief.id] = { reply: "Working", readyFile: f.gate("turn-ready"), gateFile: f.gate("turn") };
  await f.send("Start on the report.");
  await expect.poll(() => existsSync(f.gate("turn-ready")), { timeout: 15_000 }).toBe(true);
  expect((await f.send("STEERED_MID_TURN also cover costs")).steered).toBe(true);
  f.open(f.gate("turn"));
  await f.wait();

  f.plan[f.chief.id] = { reply: "Covered" };
  await f.send("Is it done?");
  await f.wait();
  const next = f.prompt(f.turns().at(-1));
  expect(count(next, "STEERED_MID_TURN")).toBe(1);
  expect(next).toMatch(/User \(sent while an earlier turn was running; you may already have it\): STEERED_MID_TURN/);
  // The block ends before the person's new message, so it never reads as one more line of it.
  expect(next.indexOf("also cover costs")).toBeLessThan(next.indexOf(UNSEEN_END));
  expect(next.slice(next.indexOf(UNSEEN_END))).toContain("Is it done?");

  f.plan[f.chief.id] = { reply: "Nothing new" };
  await f.send("Anything else?");
  await f.wait();
  expect(f.prompt(f.turns().at(-1))).not.toContain("STEERED_MID_TURN");
}), hostTimeout(60_000));

it("offers the results again when the return turn fails before the provider acts on it", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "UNACCEPTED_RESULT" };
  f.plan[f.chief.id] = f.delegate("build", [f.lead], "Build the export", { failResumed: true });
  await f.send("Please have Engineering build the export.");
  await f.wait();
  expect(f.root().status).toBe("failed");

  f.plan[f.chief.id] = { reply: "Here is what Engineering found" };
  await f.send("What did Engineering find?");
  await f.wait();
  const next = f.prompt(f.turns().at(-1));
  expect(count(next, "UNACCEPTED_RESULT")).toBe(1);
  expect(JSON.stringify(f.handed())).not.toContain("card-");
}), hostTimeout(60_000));

it("offers the results again when the person stops the return turn before the provider acts on it", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "STOPPED_RETURN_RESULT" };
  // The return turn holds on a gate that never opens: only the person's Stop ends it.
  f.plan[f.chief.id] = { turns: [{}, f.delegate("build", [f.lead], "Build the export"), { reply: "never sent", gateFile: f.gate("return") }] };
  await f.send("Please have Engineering build the export.");
  await expect.poll(() => f.nodes().find((node: any) => node.botId === f.lead.id)?.status, { timeout: 20_000 }).toBe("completed");
  await expect.poll(() => f.root()?.status, { timeout: 20_000 }).toBe("running");
  await f.api(`/api/bots/${f.chief.id}/interrupt`, { threadId: f.thread });
  await f.idle();

  // Whether the stopped fixture records a turn depends on the platform's teardown order, so the next reply is named explicitly.
  f.plan[f.chief.id] = { reply: "Recovered", resumeReply: "Recovered" };
  await f.send("What did Engineering find?");
  await f.wait();
  const next = f.turns().filter((turn: any) => f.prompt(turn).includes("What did Engineering find?")).at(-1);
  expect(count(f.prompt(next), "STOPPED_RETURN_RESULT")).toBe(1);
  const replies = (await f.messages()).map((message: any) => message.text);
  expect(replies).toContain("Recovered");
  expect(replies).not.toContain("never sent");
}), hostTimeout(60_000));

it("rebuilds a rejected resume with each result exactly once", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: `RECOVERY_RESULT_START ${"r".repeat(900)} RECOVERY_RESULT_END`, gateFile: f.gate("lead") };
  f.plan[f.chief.id] = f.delegate("build", [f.lead], "Build the export");
  await f.send("Please have Engineering build the export.");
  await leadRunning(f);
  await sourceWaiting(f);
  await f.setMode("resume=dead-session");
  f.open(f.gate("lead"));
  await f.wait();
  expect(f.launches().map((launch: any) => launch.resume)).toContain(f.launches()[0].sessionId);
  const recovered = f.prompt(f.turns().at(-1));
  expect(recovered).toContain("received an update outside your provider session");
  expect(recovered).toContain("ORCHID_7Q");
  expect(count(recovered, "RECOVERY_RESULT_START")).toBe(1);
  expect(count(recovered, "RECOVERY_RESULT_END")).toBe(1);
}), hostTimeout(60_000));
