import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { amountValue, cardBrand, cardExpired, cardLabel, validCardNumber } from "../shared/payment-cards.ts";
import { amountForms } from "./card-fill.ts";
import { unsealText } from "./sealed-text.ts";
import { json, readBody } from "./harness/http.ts";
import type { RequestAuth } from "./request-auth.ts";
import { dispatchRoutes } from "./routes/table.ts";
import { createVaultRoutes } from "./routes/vault.ts";
import type { LoginRouteDeps } from "./routes/logins.ts";
import { HeldSecrets, LOGINS_FILE, LOGINS_KEY_FILE, VaultStore } from "./vault-store.ts";

// Obvious fakes only: the card networks' published test numbers.
const VISA = "4242424242424242";
const AMEX = "378282246310005";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "omb-cards-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("card numbers and totals", () => {
  it("checks a number, names its network and labels it by its last four digits", () => {
    expect(validCardNumber("4242 4242 4242 4242")).toBe(true);
    expect(validCardNumber("4242-4242-4242-4241")).toBe(false);
    expect(validCardNumber("4242")).toBe(false);
    expect([cardBrand(VISA), cardBrand(AMEX), cardBrand("5555555555554444"), cardBrand("6011111111111117")]).toEqual(["visa", "amex", "mastercard", "discover"]);
    expect(cardLabel({ name: "Personal", brand: "visa", last4: "4242" })).toBe("Personal (Visa ••4242)");
    expect(cardLabel({ name: "", brand: "amex", last4: "0005" })).toBe("American Express ••0005");
  });

  it("is expired only after the last day of its month", () => {
    const may2030 = Date.UTC(2030, 4, 31, 23);
    expect(cardExpired({ expMonth: 5, expYear: 2030 }, may2030)).toBe(false);
    expect(cardExpired({ expMonth: 4, expYear: 2030 }, may2030)).toBe(true);
  });

  it("reads one total however a shop writes it, and nothing that is not plainly one amount", () => {
    expect(["$1,042.10", "1.042,10 €", "USD 1042.1", "¥1,042", "£ 7"].map(amountValue)).toEqual(["1042.10", "1042.10", "1042.10", "1042.00", "7.00"]);
    expect([amountValue("free"), amountValue("$5 or $10")]).toEqual([null, null]);
    expect(amountForms("1042.10")).toEqual(expect.arrayContaining(["1042.10", "1,042.10", "1.042,10", "1042,10"]));
    expect(amountForms("42.00")).toContain("42");
  });
});

describe("saved cards in the Vault", () => {
  it("live in the sealed file beside the logins, which the previous release still opens, and never show the number", () => {
    const store = new VaultStore({ dataDir: dir, now: () => 7 });
    const card = store.saveCard({ name: "Personal", number: VISA, expMonth: 4, expYear: 2031, cvc: "314", holder: "Ada Lovelace", postalCode: "94107", bots: ["pepper"] });
    expect(card).toEqual({ id: card.id, name: "Personal", brand: "visa", last4: "4242", expMonth: 4, expYear: 2031, hasCvc: true, holder: "Ada Lovelace", postalCode: "94107", bots: ["pepper"], createdAt: 7, updatedAt: 7 });
    expect(readFileSync(join(dir, LOGINS_FILE)).includes(Buffer.from(VISA))).toBe(false);
    const reopened = new VaultStore({ dataDir: dir });
    expect(reopened.listCards()).toEqual([card]);
    expect(JSON.stringify(reopened.listCards())).not.toContain(VISA);
    expect(reopened.card(card.id)).toMatchObject({ number: VISA, cvc: "314" });
    const written = JSON.parse(unsealText(readFileSync(join(dir, LOGINS_FILE)), readFileSync(join(dir, LOGINS_KEY_FILE), "utf8").trim()));
    expect(z.object({ version: z.literal(1), logins: z.array(z.unknown()) }).parse(written).logins).toEqual([]);
  });

  it("are kept to the bots chosen, replaced when the same number is saved again, and go with the last bot they were kept to", () => {
    const store = new VaultStore({ dataDir: dir });
    const first = store.saveCard({ name: "Old", number: VISA, expMonth: 1, expYear: 2030, bots: ["pepper"] });
    const again = store.saveCard({ name: "Renewed", number: `${VISA.slice(0, 4)} ${VISA.slice(4)}`, expMonth: 1, expYear: 2034, bots: ["pepper", "quill"] });
    expect(again.id).toBe(first.id);
    expect(store.listCards()).toHaveLength(1);
    expect(store.cardsFor("quill").map((card) => card.name)).toEqual(["Renewed"]);
    expect(store.cardsFor("sage")).toEqual([]);
    store.forgetBot("quill");
    expect(store.listCards()[0]!.bots).toEqual(["pepper"]);
    store.forgetBot("pepper");
    expect(store.listCards()).toEqual([]);
  });

  it("change only what is sent, and clear the name on card or ZIP when sent empty", () => {
    const store = new VaultStore({ dataDir: dir });
    const card = store.saveCard({ name: "Personal", number: VISA, expMonth: 4, expYear: 2031, cvc: "314", holder: "Ada", postalCode: "94107", bots: "all" });
    const changed = store.updateCard(card.id, { expYear: 2033, postalCode: null });
    expect(changed).toMatchObject({ expYear: 2033, holder: "Ada", hasCvc: true });
    expect(changed).not.toHaveProperty("postalCode");
    expect(store.card(card.id)).toMatchObject({ number: VISA, cvc: "314" });
    expect(store.removeCard(card.id)).toBe(true);
    expect(store.removeCard(card.id)).toBe(false);
  });

  it("mask the number wherever text crosses to a bot, grouped or whole", () => {
    const store = new VaultStore({ dataDir: dir });
    store.saveCard({ name: "", number: AMEX, expMonth: 4, expYear: 2031, bots: "all" });
    const held = new HeldSecrets(store);
    expect(held.scrub(`card ${AMEX}, or 3782 822463 10005, or 3782-822463-10005`)).toBe("card ••••••, or ••••••, or ••••••");
  });
});

describe("the Vault's card routes", () => {
  const servers: Server[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });

  async function serve() {
    const store = new VaultStore({ dataDir: dir });
    const logins = { list: () => [], botExists: (id: string) => id === "pepper", onePassword: { list: () => [], status: () => ({ connected: false }) } } as unknown as Pick<LoginRouteDeps, "list" | "botExists" | "onePassword">;
    const routes = [createVaultRoutes({ logins, secrets: store, cards: store, reader: (auth) => ({ person: null, team: auth.scopes.includes("admin") }) })];
    const said: string[] = [];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const auth = { kind: "session", scopes: req.headers["x-test-as"] === "member" ? ["client"] : ["admin", "client"] } as unknown as RequestAuth;
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (method: string, path: string, body?: unknown, as?: string) => {
      const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(as ? { "x-test-as": as } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text();
      said.push(text);
      return { status: response.status, body: JSON.parse(text) };
    };
    return { store, call, said };
  }

  it("add, list, change and delete a card, and never answer with its number or security code", async () => {
    const { store, call, said } = await serve();
    const added = await call("POST", "/api/vault/cards", { name: " Personal ", number: "4242 4242 4242 4242", expMonth: "4", expYear: 31, cvc: "314", holder: "Ada", postalCode: "94107", bots: ["pepper"] });
    expect(added).toMatchObject({ status: 201, body: { card: { name: "Personal", last4: "4242", expMonth: 4, expYear: 2031, hasCvc: true, bots: ["pepper"] } } });
    const id = added.body.card.id as string;
    expect((await call("GET", "/api/vault")).body.cards).toHaveLength(1);
    expect(await call("PATCH", `/api/vault/cards/${id}`, { expYear: 2034, holder: "" })).toMatchObject({ status: 200, body: { card: { expYear: 2034 } } });
    expect(store.card(id)).not.toHaveProperty("holder");
    expect(await call("DELETE", `/api/vault/cards/${id}`)).toMatchObject({ status: 200, body: { ok: true } });
    expect(said.join("\n")).not.toMatch(/4242424242424242|"314"/u);
  });

  it("refuse a number that fails its check, a bad expiry or security code, an unknown bot, and a Team Cloud member", async () => {
    const { call } = await serve();
    const card = { number: VISA, expMonth: 4, expYear: 2031 };
    expect((await call("POST", "/api/vault/cards", { ...card, number: "4242424242424241" })).status).toBe(400);
    expect((await call("POST", "/api/vault/cards", { ...card, expMonth: 13 })).status).toBe(400);
    expect((await call("POST", "/api/vault/cards", { ...card, number: AMEX, cvc: "123" })).status).toBe(400);
    expect((await call("POST", "/api/vault/cards", { ...card, bots: ["nobody"] })).status).toBe(400);
    expect((await call("POST", "/api/vault/cards", card, "member")).status).toBe(403);
    expect((await call("GET", "/api/vault", undefined, "member")).body.cards).toEqual([]);
  });
});
