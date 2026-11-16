// No answer ever carries a saved value: a saved secret is only ever replaced. A Team Cloud member sees and deletes only
// the secrets of their own; an admin, only the team's and their own.
import { SECRET_VALUE_MAX_BYTES, VAULT_SECRET_NAME_MAX, type LinkedSecret } from "../../shared/vault.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { McpKeys } from "../vault/mcp-keys.ts";
import { TEAM_READER, type VaultReader, type VaultStore } from "../vault-store.ts";
import { isJson, parseBots, type LoginRouteDeps } from "./logins.ts";
import { newCard, parseCardFields } from "./vault-cards.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface VaultRouteDeps {
  logins: Pick<LoginRouteDeps, "list" | "botExists" | "onePassword">;
  secrets: Pick<VaultStore, "listSecrets" | "saveSecret" | "receiveSecret" | "updateSecret" | "removeSecret">;
  /** Saved payment cards: an admin's only, never a Team Cloud member's. */
  cards?: Pick<VaultStore, "listCards" | "saveCard" | "updateCard" | "removeCard">;
  /** A linked password manager's secrets, listed beside the saved ones and changed only in the manager. */
  linked?: () => LinkedSecret[];
  /** Which MCP servers lose their key when a secret is deleted. */
  keys?: Pick<McpKeys, "usedBy">;
  /** Whose secrets this caller sees; absent: the team's, as an admin's. */
  reader?(auth: RequestAuth): VaultReader;
}

const SECRETS = "/api/vault/secrets";
const CARDS = "/api/vault/cards";
const ID = /^[\w-]{1,128}$/u;

export const VAULT_ERRORS = {
  name: `Give the secret a name of at most ${VAULT_SECRET_NAME_MAX} characters.`,
  value: `Enter the secret. It can be at most ${SECRET_VALUE_MAX_BYTES} bytes.`,
} as const;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Absent leaves it. */
function parseName(raw: unknown): Parsed<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  const name = typeof raw === "string" ? [...raw].map((ch) => (ch.charCodeAt(0) < 0x20 || ch === "\u007f" ? " " : ch)).join("").trim() : "";
  return name && name.length <= VAULT_SECRET_NAME_MAX ? { ok: true, value: name } : { ok: false, error: VAULT_ERRORS.name };
}

function parseValue(raw: unknown): Parsed<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  const value = typeof raw === "string" ? raw.trim() : "";
  return value && Buffer.byteLength(value) <= SECRET_VALUE_MAX_BYTES ? { ok: true, value } : { ok: false, error: VAULT_ERRORS.value };
}

export function createVaultRoutes(deps: VaultRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/vault" && !path.startsWith("/api/vault/")) return PASS;
    res.setHeader("cache-control", "no-store");
    const reader = deps.reader?.(auth) ?? TEAM_READER;
    const readable = (id: string) => deps.secrets.listSecrets(reader).some((secret) => secret.id === id);
    if (path === "/api/vault") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      if (!reader.team) return json(res, 200, { logins: [], secrets: deps.secrets.listSecrets(reader), cards: [], onePassword: { connected: false } });
      return json(res, 200, {
        logins: [...deps.logins.list(), ...deps.logins.onePassword.list()], secrets: [...deps.secrets.listSecrets(reader), ...(deps.linked?.() ?? [])],
        cards: deps.cards?.listCards() ?? [], onePassword: deps.logins.onePassword.status(),
      });
    }
    if (path === CARDS || path.startsWith(`${CARDS}/`)) return cardRoute();
    if (path !== SECRETS && !path.startsWith(`${SECRETS}/`)) return json(res, 404, { error: "not found" });

    async function cardRoute() {
      const cards = deps.cards;
      if (!cards) return json(res, 404, { error: "not found" });
      if (!reader.team) return json(res, 403, { error: "Only an admin can add or change a card in the Vault." });
      if (method !== "GET" && method !== "DELETE" && !isJson(req)) return json(res, 415, { error: "content-type must be application/json" });
      if (path === CARDS) {
        if (method !== "POST") return json(res, 405, { error: "method not allowed" });
        const body = await readBody(req, 8_192);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "send the card as a JSON object" });
        const fields = parseCardFields(body, { creating: true });
        if (!fields.ok) return json(res, 400, { error: fields.error });
        const bots = parseBots(body.bots ?? "all", deps.logins.botExists);
        if (!bots.ok) return json(res, 400, { error: bots.error });
        return json(res, 201, { card: cards.saveCard(newCard(fields.value, bots.value ?? "all")) });
      }
      const id = path.slice(`${CARDS}/`.length);
      const current = ID.test(id) ? cards.listCards().find((card) => card.id === id) : undefined;
      if (!current) return json(res, 404, { error: "no such card" });
      if (method === "DELETE") return cards.removeCard(id) ? json(res, 200, { ok: true }) : json(res, 404, { error: "no such card" });
      if (method !== "PATCH") return json(res, 405, { error: "method not allowed" });
      const body = await readBody(req, 8_192);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "send the change as a JSON object" });
      const fields = parseCardFields(body, { creating: false, saved: current });
      if (!fields.ok) return json(res, 400, { error: fields.error });
      const bots = parseBots(body.bots, deps.logins.botExists);
      if (!bots.ok) return json(res, 400, { error: bots.error });
      const card = cards.updateCard(id, { ...fields.value, ...(bots.value === undefined ? {} : { bots: bots.value }) });
      return card ? json(res, 200, { card }) : json(res, 404, { error: "no such card" });
    }
    if (!reader.team && method !== "DELETE") return json(res, 403, { error: "Only an admin can add or change a secret in the Vault." });
    // JSON only, so a form posted from another local page cannot add or change one.
    if (method !== "GET" && method !== "DELETE" && !isJson(req)) return json(res, 415, { error: "content-type must be application/json" });
    if (path === SECRETS) {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const body = await readBody(req, SECRET_VALUE_MAX_BYTES * 4);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "send the secret as a JSON object" });
      const name = parseName(body.name);
      if (!name.ok || name.value === undefined) return json(res, 400, { error: VAULT_ERRORS.name });
      const value = parseValue(body.value);
      if (!value.ok || value.value === undefined) return json(res, 400, { error: VAULT_ERRORS.value });
      const bots = parseBots(body.bots ?? "all", deps.logins.botExists);
      if (!bots.ok) return json(res, 400, { error: bots.error });
      const fields = { name: name.value, value: value.value, bots: bots.value ?? "all" };
      if (body.id === undefined) return json(res, 201, { secret: deps.secrets.saveSecret({ ...fields, source: "settings" }) });
      // A secret arriving from this person's computer keeps that computer's id, so an MCP server's `vault:<id>` still names it.
      if (typeof body.id !== "string" || !ID.test(body.id)) return json(res, 400, { error: "send the secret's id" });
      const received = deps.secrets.receiveSecret({ ...fields, id: body.id, source: body.source === "card" ? "card" : "settings", ...(body.refOnly === true ? { refOnly: true } : {}) });
      return received ? json(res, 201, { secret: received }) : json(res, 404, { error: "no such secret" });
    }
    const id = path.slice(`${SECRETS}/`.length);
    if (!ID.test(id) || !readable(id)) return json(res, 404, { error: "no such secret" });
    if (method === "DELETE") {
      if (!deps.secrets.removeSecret(id)) return json(res, 404, { error: "no such secret" });
      const keysOff = deps.keys?.usedBy(id) ?? [];
      return json(res, 200, { ok: true, ...(keysOff.length ? { keysOff } : {}) });
    }
    if (method !== "PATCH") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req, SECRET_VALUE_MAX_BYTES * 4);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "send the change as a JSON object" });
    const name = parseName(body.name);
    if (!name.ok) return json(res, 400, { error: name.error });
    const value = parseValue(body.value);
    if (!value.ok) return json(res, 400, { error: value.error });
    const bots = parseBots(body.bots, deps.logins.botExists);
    if (!bots.ok) return json(res, 400, { error: bots.error });
    const secret = deps.secrets.updateSecret(id, {
      ...(name.value === undefined ? {} : { name: name.value }),
      ...(value.value === undefined ? {} : { value: value.value }),
      ...(bots.value === undefined ? {} : { bots: bots.value }),
    });
    return secret ? json(res, 200, { secret }) : json(res, 404, { error: "no such secret" });
  };
}
