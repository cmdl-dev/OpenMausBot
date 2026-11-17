import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { removeTempDir } from "./testing/cleanup.ts";

// Obvious fakes only: Stripe's published test card.
const NUMBER = "4242424242424242";

it("saves a card the Vault never answers with, and a bot's fill_card off its browser answers in words and asks nothing", async () => {
  const gates = mkdtempSync(join(tmpdir(), "omb-payment-card-"));
  const gate = join(gates, "finish");
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate });
  const evidence: unknown[] = [];
  const said: string[] = [];
  const api = async (method: string, path: string, body?: unknown, expected = 200, token?: string) => {
    const response = await fetch(fixture.info.url + path, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    said.push(text);
    const result = JSON.parse(text) as any;
    evidence.push({ method, path, status: response.status, result });
    expect(response.status, text).toBe(expected);
    return result;
  };
  try {
    const bot = (await api("POST", "/api/bots", { name: "Payment fixture" }, 201)).bot;
    // Off its browser: a Linux server has a pinned Chrome for Testing to fetch, so a bot would otherwise work there.
    await api("PATCH", `/api/bots/${bot.id}`, { browser: false });
    const card = (await api("POST", "/api/vault/cards", { name: "Personal", number: NUMBER, expMonth: 4, expYear: 2031, cvc: "314", bots: [bot.id] }, 201)).card;
    expect(card).toMatchObject({ name: "Personal", brand: "visa", last4: "4242", hasCvc: true, bots: [bot.id] });
    expect((await api("GET", "/api/vault")).cards).toEqual([card]);
    expect((await api("PATCH", `/api/vault/cards/${card.id}`, { expYear: 2033 })).card).toMatchObject({ expYear: 2033, last4: "4242" });

    await runControlOmb(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Buy the tickets.", "--url", fixture.info.url]);
    let token = "";
    await expect.poll(() => {
      try { token = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).mcpConfig.mcpServers.agents.env.OMB_COMMS_TOKEN; }
      catch { return false; }
      return Boolean(token);
    }, { timeout: 15_000 }).toBe(true);
    const fill = await api("POST", "/api/internal/fill-card", { fromBotId: bot.id, fromThreadId: bot.threadId, amount: "$42.10", item: "2 tickets" }, 200, token);
    expect(fill.ok).toBe(false);
    expect(fill.text).toContain("fill_card works only in your own browser");
    expect((await api("POST", "/api/internal/fill-card", { fromBotId: bot.id, fromThreadId: bot.threadId, amount: "$42.10", item: "2 tickets" }, 401)).error).toBe("unauthorized");

    writeFileSync(gate, "finish");
    await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).bots.find((one: any) => one.id === bot.id).busy, { timeout: 15_000 }).toBe(false);
    const transcript = await api("GET", `/api/threads/${bot.threadId}/messages`);
    expect(transcript.messages.some((message: any) => message.card?.paymentRequest)).toBe(false);
    expect(await api("DELETE", `/api/vault/cards/${card.id}`)).toEqual({ ok: true });
    expect((await api("GET", "/api/vault")).cards).toEqual([]);
    expect(said.join("\n")).not.toContain(NUMBER);
    expect(readFileSync(fixture.info.logPath, "utf8")).not.toContain(NUMBER);
  } finally {
    const evidencePath = `${fixture.info.logPath}.payment-card.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ evidencePath, logPath: fixture.info.logPath }));
    await fixture.close();
    await removeTempDir(gates);
  }
}, 60_000);
