// A usage hub is a CLIProxyAPI gateway (such as Router) that holds Claude and Codex subscription sign-ins for this
// server's engines. Its management key reads every connected account's 5-hour and weekly windows through the hub's
// own `api-call`, so accounts behind a gateway show their usage without a sign-in on this computer.
// The management key stays in usage-hubs.json (0600) and in request headers; no answer or error ever carries it.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { readClaudeAuthSettings } from "./drivers/claude.ts";
import { parseClaudeUsage, parseCodexUsage, type PlanAccount, type PlanProviderRow, type PlanWindows } from "./plan-usage.ts";

export interface UsageHub {
  id: string;
  label: string;
  url: string;
  managementKey: string;
}

/** What the settings page sees of a hub. */
export interface UsageHubView {
  id: string;
  label: string;
  url: string;
}

export interface HubResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type HubFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal; redirect: "error" }) => Promise<HubResponse>;

interface HubAccount {
  id: string;
  authIndex: string;
  provider: "claude" | "codex";
  email: string | null;
  chatgptAccountId: string | null;
}

const HUB_FILE = "usage-hubs.json";
const HUB_TIMEOUT_MS = 15_000;
const HUB_CACHE_MS = 45_000;
const MAX_HUBS = 8;
const MAX_ACCOUNTS = 40;
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
// The OAuth usage endpoint can answer 429 to a request without a Claude Code user agent.
const CLAUDE_HEADERS = { Authorization: "Bearer $TOKEN$", "anthropic-beta": "oauth-2025-04-20", "User-Agent": "claude-code/2.1.273" };
const CODEX_HEADERS = { Authorization: "Bearer $TOKEN$", "Content-Type": "application/json", "OpenAI-Beta": "codex-1", Originator: "Codex Desktop" };

const defaultFetch: HubFetch = (url, init) => globalThis.fetch(url, init);

export class HubError extends Error {}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The hub's own address: a pasted inference URL (…/v1) or management URL (…/v0/management) is cut back to it. */
export function hubBaseUrl(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new HubError("Enter the hub's address, like https://router.example:14443."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HubError("The hub's address must start with https:// or http://.");
  if (url.username || url.password) throw new HubError("Put the management key in its own field, not in the address.");
  const path = url.pathname.replace(/\/+$/, "").replace(/\/(v1|v0\/management|v8\/management)$/, "");
  return `${url.origin}${path}`;
}

export class UsageHubStore {
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = join(dataDir, HUB_FILE);
  }

  hubs(): UsageHub[] {
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(this.file, "utf8")); } catch { return []; }
    const list = Array.isArray(record(raw)?.hubs) ? record(raw)!.hubs as unknown[] : [];
    return list.flatMap((entry) => {
      const hub = record(entry);
      const id = text(hub?.id), label = text(hub?.label), url = text(hub?.url), managementKey = text(hub?.managementKey);
      return id && label && url && managementKey ? [{ id, label, url, managementKey }] : [];
    }).slice(0, MAX_HUBS);
  }

  views(): UsageHubView[] {
    return this.hubs().map(({ id, label, url }) => ({ id, label, url }));
  }

  /** Checks the key by listing the hub's accounts before it is saved. */
  async add(input: { label?: unknown; url?: unknown; managementKey?: unknown }, fetchImpl: HubFetch = defaultFetch): Promise<UsageHubView> {
    const label = (text(input.label) ?? "Router").slice(0, 60);
    const managementKey = text(input.managementKey);
    if (typeof input.url !== "string") throw new HubError("Enter the hub's address.");
    if (!managementKey || managementKey.length > 512) throw new HubError("Paste the hub's management key.");
    const url = hubBaseUrl(input.url);
    const hubs = this.hubs();
    if (hubs.length >= MAX_HUBS) throw new HubError(`At most ${MAX_HUBS} usage hubs.`);
    const hub = { id: randomUUID(), label, url, managementKey };
    await hubAccounts(hub, fetchImpl);
    this.save([...hubs.filter((saved) => saved.url !== url), hub]);
    clearHubUsageCache();
    return { id: hub.id, label, url };
  }

  remove(id: string): boolean {
    const hubs = this.hubs();
    const kept = hubs.filter((hub) => hub.id !== id);
    if (kept.length === hubs.length) return false;
    this.save(kept);
    clearHubUsageCache();
    return true;
  }

  private save(hubs: UsageHub[]): void {
    writeFileAtomic(this.file, `${JSON.stringify({ hubs }, null, 2)}\n`, { mode: 0o600 });
  }
}

async function management(hub: UsageHub, path: string, fetchImpl: HubFetch, body?: unknown): Promise<unknown> {
  let response: HubResponse;
  try {
    response = await fetchImpl(`${hub.url}/v0/management/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${hub.managementKey}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
      redirect: "error",
    });
  } catch (error) {
    throw new HubError(error instanceof Error && error.name === "TimeoutError" ? "The hub did not answer within 15 seconds." : "Could not reach the hub.");
  }
  if (response.status === 401 || response.status === 403) throw new HubError("The hub refused the management key.");
  if (response.status === 404) throw new HubError("That address has no CLIProxyAPI management API (or remote management is off).");
  if (!response.ok) throw new HubError(`The hub answered with HTTP ${response.status}.`);
  try { return await response.json(); } catch { throw new HubError("The hub sent an answer that isn't JSON."); }
}

async function hubAccounts(hub: UsageHub, fetchImpl: HubFetch): Promise<HubAccount[]> {
  const files = record(await management(hub, "auth-files", fetchImpl))?.files;
  if (!Array.isArray(files)) throw new HubError("The hub sent an unexpected account list.");
  return files.flatMap((entry): HubAccount[] => {
    const file = record(entry);
    const provider = file?.provider;
    const id = text(file?.id), authIndex = text(file?.auth_index);
    if ((provider !== "claude" && provider !== "codex") || !id || !authIndex || file?.disabled === true) return [];
    return [{ id, authIndex, provider, email: text(file?.email) ?? text(file?.label), chatgptAccountId: text(record(file?.id_token)?.chatgpt_account_id) }];
  }).slice(0, MAX_ACCOUNTS);
}

async function accountUsage(hub: UsageHub, account: HubAccount, fetchImpl: HubFetch): Promise<PlanWindows> {
  const header = account.provider === "claude" ? CLAUDE_HEADERS
    : { ...CODEX_HEADERS, ...(account.chatgptAccountId ? { "Chatgpt-Account-Id": account.chatgptAccountId } : {}) };
  const answer = record(await management(hub, "api-call", fetchImpl, {
    auth_index: account.authIndex, method: "GET", url: account.provider === "claude" ? CLAUDE_USAGE_URL : CODEX_USAGE_URL, header,
  }));
  const status = typeof answer?.status_code === "number" ? answer.status_code : 0;
  if (status === 401 || status === 403) throw new HubError("This account's sign-in on the hub has expired. Sign in again on the hub.");
  if (status < 200 || status >= 300) throw new HubError(status ? `The provider refused the hub's request (HTTP ${status}).` : "The hub sent an unexpected answer.");
  let body: unknown;
  try { body = JSON.parse(String(answer?.body ?? "")); } catch { throw new HubError("The provider sent a usage answer that isn't JSON."); }
  return account.provider === "claude" ? parseClaudeUsage(body) : parseCodexUsage(body);
}

function closed() {
  return { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
}

function hubRow(id: string, name: string, plan: string | null, result: PlanWindows | HubError): PlanProviderRow {
  if (result instanceof HubError) return { id, name, driver: "hub", plan, ok: false, error: result.message, fiveHour: closed(), weekly: closed(), extra: [], models: [] };
  return { id, name, driver: "hub", plan, ok: true, error: null, fiveHour: result.fiveHour, weekly: result.weekly, extra: result.extra, models: result.models };
}

async function hubRows(hub: UsageHub, fetchImpl: HubFetch): Promise<PlanProviderRow[]> {
  let accounts: HubAccount[];
  try {
    accounts = await hubAccounts(hub, fetchImpl);
  } catch (error) {
    return [hubRow(`hub:${hub.id}`, hub.label, null, error instanceof HubError ? error : new HubError("The hub could not list its accounts."))];
  }
  return Promise.all(accounts.map(async (account) => {
    const usage = await accountUsage(hub, account, fetchImpl).catch((error) => error instanceof HubError ? error : new HubError("The hub could not read this account's usage."));
    const product = account.provider === "claude" ? "Claude" : "Codex";
    const plan = [usage instanceof HubError ? null : usage.plan, account.email].filter(Boolean).join(" · ") || null;
    return hubRow(`hub:${hub.id}:${account.id}`, `${product} (${hub.label})`, plan, usage);
  }));
}

let cached: { at: number; key: string; rows: PlanProviderRow[] } | null = null;

export function clearHubUsageCache(): void {
  cached = null;
}

/** One row per enabled Claude or Codex account on each hub, or one error row for a hub that can't be read. */
export async function loadHubUsage(hubs: UsageHub[], input: { refresh?: boolean; now?: number; fetch?: HubFetch } = {}): Promise<PlanProviderRow[]> {
  if (hubs.length === 0) return [];
  const now = input.now ?? Date.now();
  const key = hubs.map((hub) => `${hub.id}\n${hub.url}`).join("\n\n");
  if (!input.refresh && cached?.key === key && now - cached.at < HUB_CACHE_MS) return cached.rows;
  const rows = (await Promise.all(hubs.map((hub) => hubRows(hub, input.fetch ?? defaultFetch)))).flat();
  cached = { at: now, key, rows };
  return rows;
}

/** The host a Claude account sends its requests to when that is not Anthropic, from the instance's environment, this
 * server's or Claude Code's settings.json `env`. Such an account has no sign-in here for the usage meter to read. */
export function claudeGatewayHost(account: PlanAccount, env: NodeJS.ProcessEnv = process.env): string | null {
  if (account.driver !== "claude") return null;
  const base = account.environment.ANTHROPIC_BASE_URL || env.ANTHROPIC_BASE_URL || readClaudeAuthSettings(env, account.environment).env?.ANTHROPIC_BASE_URL;
  let host: string;
  try { host = new URL(base ?? "").hostname.toLowerCase(); } catch { return null; }
  return host === "api.anthropic.com" ? null : host;
}

/** The plan rows with each hub's accounts added. A Claude account that reaches Claude through a gateway is dropped when
 * a hub on that gateway's host lists its accounts, and otherwise says where its usage can be read. */
export function withHubRows(providers: PlanProviderRow[], accounts: PlanAccount[], hubs: UsageHub[], hubRowsRead: PlanProviderRow[], env: NodeJS.ProcessEnv = process.env): PlanProviderRow[] {
  const hubHosts = new Set(hubs.map((hub) => { try { return new URL(hub.url).hostname.toLowerCase(); } catch { return ""; } }));
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const own = providers.flatMap((row) => {
    const account = byId.get(row.id);
    const gateway = !row.ok && account ? claudeGatewayHost(account, env) : null;
    if (!gateway) return [row];
    if (hubHosts.has(gateway)) return [];
    return [{ ...row, error: `Reaches Claude through ${gateway}. Add that gateway below as a usage hub to see its accounts.` }];
  });
  return [...own, ...hubRowsRead];
}
