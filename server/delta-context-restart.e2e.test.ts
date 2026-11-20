import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";

import { count, fixture, warmUp } from "./testing/delta-context-fixture.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { openSse } from "./testing/sse.ts";

it("keeps a teammate stopped with its source stopped across a restart: nothing reruns and no result lands", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "RESULT_AFTER_RESTART", gateFile: f.gate("after-restart") };
  f.plan[f.chief.id] = f.delegate("build", [f.lead], "Build the export");
  await f.send("Please have Engineering build the export.");
  await expect.poll(() => f.nodes().find((node: any) => node.botId === f.lead.id)?.status, { timeout: 15_000 }).toBe("running");
  await f.api(`/api/bots/${f.chief.id}/interrupt`, { threadId: f.thread });
  await f.wait();
  await expect.poll(() => f.nodes().find((node: any) => node.botId === f.lead.id)?.status, { timeout: 15_000 }).toBe("cancelled");
  await f.restart(() => {}, "SIGTERM");
  f.open(f.gate("after-restart"));
  f.plan[f.chief.id] = { reply: "Engineering was stopped" };
  await f.send("What happened to the Engineering work?");
  await f.wait();
  expect(f.nodes().find((node: any) => node.botId === f.lead.id)?.status).toBe("cancelled");
  expect((await f.messages()).some((m: any) => m.tool?.name === "Engineering lead replied")).toBe(false);
  expect(count(f.prompt(f.turns().at(-1)), "RESULT_AFTER_RESTART")).toBe(0);
}), hostTimeout(90_000));

it.each(["SIGTERM", "SIGKILL"] as const)("runs each teammate turn a restart cut again once, in place, and resumes the Chief told so (%s)", (signal) => fixture(async (f) => {
  const chats: string[] = [];
  const upstream = createServer(async (req, res) => {
    if (req.url === "/v1/models") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [{ id: "fixture-model" }] })); return; }
    let body = "";
    // Only a turn's POST carries a body; the Ollama probe GETs /api/version first (ollama-context.ts).
    if (req.method !== "POST") { res.writeHead(404); res.end(); return; }
    for await (const chunk of req) body += chunk;
    const content = JSON.parse(body).messages.filter((m: any) => m.role === "user").at(-1)?.content;
    chats.push(typeof content === "string" ? content : JSON.stringify(content));
    if (chats.length === 1) return;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "OPS_RESUMED_RESULT" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  try {
    await f.api("/api/config", { openaiCompat: { key: "synthetic-fixture-key", url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`, model: "fixture-model" } }, "PATCH");
    await f.cli("set-model", "--bot", f.ops.id, "--instance", "openaiCompat", "--model", "fixture-model");
    await warmUp(f);
    // Engineering has visibly acted when the restart cuts it, so the rerun resumes that session.
    f.plan[f.lead.id] = { progress: "LEAD_WORKING", reply: "LEAD_RESUMED_RESULT", gateFile: f.gate("lead") };
    f.plan[f.chief.id] = f.delegate("build", [f.lead, f.ops], "Build the export", { resumeReply: "RESTART_REVIEWED" });
    await f.send("Please have Engineering and Ops build the export.");
    await expect.poll(() => f.nodes().filter((node: any) => node.parentId).map((node: any) => node.status), { timeout: 15_000 }).toEqual(["running", "running"]);
    await expect.poll(() => f.root()?.status, { timeout: 15_000 }).toBe("waiting");
    await expect.poll(() => chats.length, { timeout: 15_000 }).toBe(1);
    const workThreads = Object.fromEntries(f.nodes().filter((node: any) => node.parentId).map((node: any) => [node.botId, node.threadId]));
    await expect.poll(async () => (await f.messages(workThreads[f.lead.id])).some((m: any) => m.text?.includes("LEAD_WORKING")), { timeout: 15_000 }).toBe(true);
    f.plan[f.qa.id] = { reply: "never answered", gateFile: f.gate("qa-never") };
    f.save();
    await f.api(`/api/bots/${f.qa.id}/messages`, { text: "Check the release notes.", threadId: f.qa.activeTaskId });
    await expect.poll(() => f.consumed(f.qa.id), { timeout: 15_000 }).toBe(1);
    const leadSession = f.nativeSession(f.lead.id);
    const chiefTurns = f.turns().length;

    await f.restart(() => {}, signal);
    const stream = await openSse(`${f.session.info.url}/api/events`);
    try {
      f.open(f.gate("lead"));
      await expect.poll(async () => (await f.messages()).some((m: any) => m.text === "RESTART_REVIEWED"), { timeout: 30_000 }).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(stream.frames.filter((frame) => frame.kind === "notify").map((frame) => [frame.notification?.kind, frame.notification?.body]))
        .toEqual([["delegation-settled", "Results in from Engineering lead, Ops"]]);
    } finally {
      stream.close();
    }
    expect(f.launches(f.lead.id).at(-1).resume).toBe(leadSession);
    expect(f.turns(f.lead.id).map((turn: any) => f.prompt(turn).includes("this turn continues it"))).toEqual([true]);
    expect(f.prompt(f.turns(f.lead.id)[0])).toContain("Build the export");
    expect(chats).toHaveLength(2);
    expect(chats[1]).toContain("this turn continues it");
    expect(f.turns()).toHaveLength(chiefTurns + 1);
    const review = f.prompt(f.turns().at(-1));
    expect(f.turns().at(-1).resumed).toBe(true);
    expect(review).toContain("A restart cut these teammates' turns: Engineering lead (resumed once in place and told to check what it had already done); Ops (resumed once in place and told to check what it had already done).");
    expect(review).toContain("LEAD_RESUMED_RESULT");
    expect(review).toContain("OPS_RESUMED_RESULT");
    await expect.poll(() => f.nodes().filter((node: any) => node.threadId !== f.qa.activeTaskId).every((node: any) => node.status === "completed"), { timeout: 15_000 }).toBe(true);
    const chiefRows = (await f.messages()).map((m: any) => m.tool?.name).filter(Boolean);
    expect(chiefRows).toEqual(expect.arrayContaining(["Engineering lead was cut off by a restart; resuming", "Ops was cut off by a restart; resuming",
      "Engineering lead replied", "Ops replied", "Resumed with Engineering lead, Ops results after a restart, reviewing"]));
    expect(chiefRows.filter((name: string) => name.startsWith("error:") || name.includes("failed"))).toEqual([]);
    for (const [botId, threadId] of Object.entries(workThreads)) {
      const rows = (await f.messages(threadId)).map((m: any) => m.tool?.name).filter(Boolean);
      expect(rows.filter((name: string) => name === "Resuming after a restart"), `${botId}: ${JSON.stringify(rows)}`).toHaveLength(1);
      expect(rows.filter((name: string) => name.startsWith("error:")), botId).toEqual([]);
    }
    await expect.poll(() => f.launches(f.qa.id).length, { timeout: 15_000 }).toBe(2);
    const qaRows = (await f.messages(f.qa.activeTaskId)).map((m: any) => m.tool?.name).filter(Boolean);
    expect(qaRows.filter((name: string) => name === "Resuming after a restart")).toHaveLength(1);
    expect(qaRows.filter((name: string) => name.startsWith("error:"))).toEqual([]);
    expect(f.nodes().filter((node: any) => node.threadId === f.qa.activeTaskId).map((node: any) => [node.status, node.restarts])).toEqual([["running", 1]]);
    expect((await f.api("/api/bots")).bots.find((b: any) => b.id === f.qa.id).tasks
      .find((task: any) => task.threadId === f.qa.activeTaskId).unread).toBe(false);
  } finally {
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
}), hostTimeout(120_000));

it.each(["SIGTERM", "SIGKILL"] as const)("resumes a Chief whose own turn a restart cut after it sent work, once that work settles (%s)", (signal) => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "LEAD_DONE_BEFORE_RESTART" };
  f.plan[f.chief.id] = f.delegate("build", [f.lead], "Build the export", { gateFile: f.gate("chief"), resumeReply: "CUT_REVIEWED" });
  await f.send("Please have Engineering build the export.");
  await expect.poll(() => f.nodes().find((node: any) => node.parentId)?.status, { timeout: 15_000 }).toBe("completed");
  expect(f.root()?.status).toBe("source");
  const chiefTurns = f.turns().length;
  await f.restart(() => {}, signal);
  f.open(f.gate("chief"));
  await expect.poll(async () => (await f.messages()).some((m: any) => m.text === "CUT_REVIEWED"), { timeout: 30_000 }).toBe(true);
  expect(f.turns()).toHaveLength(chiefTurns + 1);
  expect(f.turns().at(-1).resumed).toBe(true);
  expect(f.prompt(f.turns().at(-1))).toContain("OpenMausBot restarted before your previous turn here finished, after it sent work to teammates.");
  expect(f.prompt(f.turns().at(-1))).toContain("LEAD_DONE_BEFORE_RESTART");
  expect(f.turns(f.lead.id)).toHaveLength(1);
  // The final reply is saved before the Chief's graph settlement is persisted.
  await expect.poll(() => f.root()?.status, { timeout: 15_000 }).toBe("completed");
  expect(f.nodes().every((node: any) => node.status === "completed")).toBe(true);
  expect((await f.messages()).map((m: any) => m.tool?.name).filter((name: string | undefined) => name?.startsWith("error:"))).toEqual([]);
}), hostTimeout(90_000));

it("tells the requester when a teammate's review a restart cut runs again", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.qa.id] = { reply: "QA_VERIFIED" };
  f.plan[f.lead.id] = { turns: [
    { steps: [{ arguments: { bot_ids: [f.qa.id], request_key: "verify", message: "Verify the export" } }], reply: "Sent to QA" },
    { reply: "LEAD_REVIEW_RERUN", gateFile: f.gate("lead-review") },
  ] };
  f.plan[f.chief.id] = f.delegate("build", [f.lead], "Build the export", { resumeReply: "CHIEF_DONE" });
  await f.send("Please have Engineering build the export.");
  const leadNode = () => f.nodes().find((node: any) => node.botId === f.lead.id);
  await expect.poll(() => f.nodes().find((node: any) => node.botId === f.qa.id)?.status, { timeout: 20_000 }).toBe("completed");
  await expect.poll(() => f.consumed(f.lead.id), { timeout: 20_000 }).toBe(2); // its turn, then its review
  expect(leadNode()?.status).toBe("running");
  await f.restart(() => {}, "SIGKILL");
  f.open(f.gate("lead-review"));
  await expect.poll(async () => (await f.messages()).some((m: any) => m.text === "CHIEF_DONE"), { timeout: 30_000 }).toBe(true);
  expect(f.turns(f.qa.id)).toHaveLength(1);
  const chiefRows = (await f.messages()).map((m: any) => m.tool?.name).filter(Boolean);
  expect(chiefRows.filter((name: string) => name === "Engineering lead was cut off by a restart; resuming")).toHaveLength(1);
  expect((await f.messages(leadNode().threadId)).filter((m: any) => m.tool?.name === "Resumed with QA results after a restart, reviewing")).toHaveLength(1);
  expect(f.prompt(f.turns().at(-1))).toContain("Engineering lead (resumed once in place and told to check what it had already done)");
}), hostTimeout(90_000));

it("runs a Chief's review a restart cut again once, without notifying again", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "LEAD_RESULT_FOR_REVIEW" };
  f.plan[f.chief.id] = { turns: [{}, f.delegate("build", [f.lead], "Build the export"), { reply: "REVIEW_RERUN_DONE", gateFile: f.gate("review") }] };
  await f.send("Please have Engineering build the export.");
  await expect.poll(async () => (await f.messages()).some((m: any) => m.tool?.name === "Resumed with Engineering lead results, reviewing"), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => f.root()?.status, { timeout: 15_000 }).toBe("running");
  await expect.poll(() => f.consumed(), { timeout: 20_000 }).toBe(3); // warm-up, delegation, its review
  const chiefTurns = f.turns().length;
  await f.restart(() => {}, "SIGKILL");
  const stream = await openSse(`${f.session.info.url}/api/events`);
  try {
    f.open(f.gate("review"));
    await expect.poll(async () => (await f.messages()).filter((m: any) => m.text === "REVIEW_RERUN_DONE").length, { timeout: 30_000 }).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(stream.frames.filter((frame) => frame.kind === "notify")).toEqual([]);
  } finally {
    stream.close();
  }
  expect(f.turns()).toHaveLength(chiefTurns + 1);
  expect(f.turns().at(-1).resumed, f.prompt(f.turns().at(-1)).slice(0, 1_500)).toBe(true);
  expect(f.prompt(f.turns().at(-1))).toContain("this turn continues it");
  expect(count(f.prompt(f.turns().at(-1)), "LEAD_RESULT_FOR_REVIEW")).toBe(1);
  expect(f.turns(f.lead.id)).toHaveLength(1);
  expect((await f.messages()).filter((m: any) => m.tool?.name === "Resumed with Engineering lead results after a restart, reviewing")).toHaveLength(1);
}), hostTimeout(90_000));

it("ends a Chief's review a second restart cuts, and says so in its conversation", () => fixture(async (f) => {
  await warmUp(f);
  f.plan[f.lead.id] = { reply: "LEAD_RESULT_FOR_REVIEW" };
  f.plan[f.chief.id] = { turns: [{}, f.delegate("build", [f.lead], "Build the export"), { reply: "NEVER_SENT", gateFile: f.gate("review") }] };
  await f.send("Please have Engineering build the export.");
  await expect.poll(() => f.root()?.status, { timeout: 20_000 }).toBe("running");
  await expect.poll(() => f.consumed(), { timeout: 20_000 }).toBe(3); // warm-up, delegation, its review
  await f.restart(() => {}, "SIGKILL");
  await expect.poll(() => f.root(), { timeout: 20_000 }).toMatchObject({ status: "running", restart: "rerun" });
  await expect.poll(() => f.consumed(), { timeout: 20_000 }).toBe(4); // warm-up, delegation, review, its rerun
  await f.restart(() => {}, "SIGKILL");
  const ended = "error: Interrupted by another OpenMausBot restart after resuming once; not resumed again. Some of its steps may already have taken effect.";
  await expect.poll(async () => (await f.messages()).filter((m: any) => m.tool?.name === ended).length, { timeout: 20_000 }).toBe(1);
  expect(f.root()).toMatchObject({ status: "failed", reported: true });
  f.open(f.gate("review"));
  await new Promise((resolve) => setTimeout(resolve, 750));
  expect(f.consumed()).toBe(4);
  expect((await f.messages()).some((m: any) => m.text === "NEVER_SENT")).toBe(false);
}), hostTimeout(90_000));
