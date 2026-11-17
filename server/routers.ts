// A Router is a CLIProxyAPI gateway holding the person's Claude and ChatGPT subscription sign-ins. Connecting one adds a
// Claude engine and a Codex engine that run through it on its client API key, each listed as one more account of its
// provider; its optional management key reads those accounts' usage (usage-hubs.ts). The API key lives only in the two
// engines' environment, like every endpoint token: no view or error carries it.
import { join } from "node:path";
import { z } from "zod";

import type { InstanceRouterInfo, RouterEngine, RouterView } from "../shared/router.ts";
import { readCatalog } from "./agent-endpoint-models.ts";
import { DATA_DIR } from "./config.ts";
import type { InstanceConfig, InstanceConfigMap } from "./contracts.ts";
import { CLAUDE_MODEL_ID } from "./drivers/claude-model-extras.ts";
import { isLoopback } from "./provider-key-check.ts";
import { hubBaseUrl, HubError, type UsageHub } from "./usage-hubs.ts";

export type { RouterEngine, RouterView };

export interface RouterModels {
  claude: string[];
  codex: string[];
}

export interface RouterIdentity {
  id: string;
  label: string;
  url: string;
}

const ENGINES: readonly RouterEngine[] = ["claude", "codex"];
const DRIVER = { claude: "claudeAgent", codex: "codex" } as const;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_MODELS = 500;
const CODEX_MODEL_ID = /^[\w][\w./+-]*$/;
// The gateway lists image models beside chat models (gpt-image-2); neither engine can hold a conversation on one.
const IMAGE_MODEL = /(?:^|[-_.])image(?:[-_.]|$)/i;

const plain = (value: string) => !/[\p{Cc}\p{Cf}]/u.test(value);
const label = z.string().trim().min(1).max(60).refine(plain, "The name cannot contain control characters.");
const secret = z.string().trim().min(1).max(4096).refine(plain, "A key cannot contain control characters.");
const address = z.string().trim().min(1).max(2048);

export const routerConnectSchema = z.object({
  label: label.optional(),
  url: address,
  apiKey: secret,
  managementKey: secret.optional(),
}).strict();

/** An omitted key keeps the saved one, unless the address changes; an empty management key removes it. */
export const routerUpdateSchema = z.object({
  label: label.optional(),
  url: address.optional(),
  apiKey: secret.optional(),
  managementKey: z.union([secret, z.literal("")]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "No settings supplied");

/** The Router's own address, refused unless its keys would travel over HTTPS or stay on this computer. */
export function routerAddress(input: string): string {
  const base = hubBaseUrl(input);
  const url = new URL(base);
  if (url.protocol !== "https:" && !isLoopback(url.hostname)) {
    throw new HubError("Use the Router's https:// address. Plain http:// works only for a Router on this computer.");
  }
  return base;
}

/** Splits the Router's `/v1/models` between the engines by each model's `owned_by`. */
export async function readRouterModels(url: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<RouterModels> {
  let response: Response;
  try {
    // A redirect must never replay the key to another address.
    response = await fetchImpl(`${url}/v1/models`, { headers: { authorization: `Bearer ${apiKey}` }, redirect: "manual", signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new HubError(timeout ? "The Router did not answer within 10 seconds." : "OpenMausBot's server could not reach the Router at that address.");
  }
  if (!response.ok) await response.body?.cancel().catch(() => {});
  if (response.status === 401 || response.status === 403) throw new HubError("The Router refused the API key. Use one of its client API keys, not its management key.");
  if (response.status >= 300 && response.status < 400) throw new HubError("The Router redirected the request. Enter its final address.");
  if (response.status === 404) throw new HubError("That address has no /v1/models. Enter the Router's own address, like https://router.example:8317.");
  if (!response.ok) throw new HubError(`The Router answered with HTTP ${response.status}.`);
  const text = await readCatalog(response, MAX_CATALOG_BYTES).catch(() => null);
  if (text === null) throw new HubError("The Router's model list could not be read.");
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new HubError("The Router sent a model list that isn't JSON."); }
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
  const models: RouterModels = { claude: [], codex: [] };
  const seen = new Set<string>();
  for (const item of Array.isArray(data) ? data.slice(0, MAX_MODELS) : []) {
    const { id, owned_by: owner } = (item && typeof item === "object" ? item : {}) as { id?: unknown; owned_by?: unknown };
    if (typeof id !== "string" || id.length > 160 || seen.has(id) || IMAGE_MODEL.test(id)) continue;
    seen.add(id);
    // Claude Code reads `--model default` as its own default, not a gateway model.
    if (owner === "anthropic") { if (CLAUDE_MODEL_ID.test(id) && id !== "default") models.claude.push(id); }
    else if (CODEX_MODEL_ID.test(id)) models.codex.push(id);
  }
  if (!models.claude.length && !models.codex.length) throw new HubError("The Router lists no models. Sign in to a Claude or ChatGPT account on the Router first.");
  return models;
}

export function routerEngineId(routerId: string, engine: RouterEngine): string {
  return `router-${routerId}-${engine}`;
}

function rawConfig(entry: InstanceConfig | undefined): Record<string, unknown> {
  return entry?.config && typeof entry.config === "object" && !Array.isArray(entry.config) ? entry.config as Record<string, unknown> : {};
}

export function routerIdOf(entry: InstanceConfig | undefined): string | null {
  const id = rawConfig(entry).router;
  return typeof id === "string" && id ? id : null;
}

function engineOf(entry: InstanceConfig): RouterEngine {
  return entry.driver === "codex" ? "codex" : "claude";
}

function modelsOf(entry: InstanceConfig): string[] {
  const config = rawConfig(entry);
  const models = entry.driver === "codex" ? (config.endpoint as { models?: unknown } | undefined)?.models : config.endpointModels;
  return Array.isArray(models) ? models.filter((model): model is string => typeof model === "string") : [];
}

export function routerEngines(instances: InstanceConfigMap, routerId: string): string[] {
  return Object.keys(instances).filter((instanceId) => routerIdOf(instances[instanceId]) === routerId);
}

/** The saved API key, which both engines carry. */
export function routerApiKey(instances: InstanceConfigMap, routerId: string): string | null {
  for (const instanceId of routerEngines(instances, routerId)) {
    const environment = instances[instanceId].environment ?? {};
    const key = environment.OPENMAUSBOT_CODEX_API_KEY ?? environment.ANTHROPIC_API_KEY;
    if (key) return key;
  }
  return null;
}

/** The CLI another engine of the same kind already runs, so a Router engine uses the same install. */
function installedCli(instances: InstanceConfigMap, driver: string): string | undefined {
  for (const entry of Object.values(instances)) {
    const cli = rawConfig(entry).cli;
    if (entry.driver === driver && !routerIdOf(entry) && typeof cli === "string" && cli) return cli;
  }
  return undefined;
}

function engineConfig(engine: RouterEngine, instanceId: string, router: RouterIdentity, apiKey: string, models: string[], cli: string | undefined): Pick<InstanceConfig, "driver" | "config" | "environment"> {
  if (engine === "claude") {
    return {
      driver: "claudeAgent",
      config: { ...(cli ? { cli } : {}), configDir: join(DATA_DIR, "providers", instanceId), requireApiKey: true, endpointModels: models, router: router.id },
      // Claude Code's auth probe and its turns both need a key they recognize; the Router's is that key.
      environment: { ANTHROPIC_BASE_URL: router.url, ANTHROPIC_AUTH_TOKEN: apiKey, ANTHROPIC_API_KEY: apiKey },
    };
  }
  return {
    driver: "codex",
    config: { ...(cli ? { cli } : {}), endpoint: { url: `${router.url}/v1`, models }, router: router.id },
    environment: { CODEX_HOME: join(DATA_DIR, "providers", instanceId), OPENMAUSBOT_CODEX_API_KEY: apiKey },
  };
}

/** Writes the Router's engines into `instances` and returns the ids whose settings changed. An engine the Router now lists no
 * models for keeps its last list, so bots on it are not cut off; none is added for an engine with no models. */
export function applyRouter(instances: InstanceConfigMap, router: RouterIdentity, apiKey: string, models: RouterModels): string[] {
  const changed: string[] = [];
  for (const engine of ENGINES) {
    const instanceId = routerEngineId(router.id, engine);
    const existing = instances[instanceId];
    const list = models[engine].length ? models[engine] : existing ? modelsOf(existing) : [];
    if (!list.length) continue;
    const savedCli = rawConfig(existing).cli;
    const cli = typeof savedCli === "string" && savedCli ? savedCli : installedCli(instances, DRIVER[engine]);
    const next: InstanceConfig = {
      ...(existing?.enabled !== undefined ? { enabled: existing.enabled } : {}),
      ...(existing?.hidden ? { hidden: true } : {}),
      ...(existing?.icon ? { icon: existing.icon } : {}),
      ...(existing?.accentColor ? { accentColor: existing.accentColor } : {}),
      ...engineConfig(engine, instanceId, router, apiKey, list, cli),
      displayName: router.label,
      // The Router bills the person's subscriptions, so its engines are accounts of their providers.
      access: "subscription",
    };
    if (JSON.stringify(next) === JSON.stringify(existing)) continue;
    instances[instanceId] = next;
    changed.push(instanceId);
  }
  return changed;
}

export function routerViews(hubs: UsageHub[], instances: InstanceConfigMap): RouterView[] {
  return hubs.filter((hub) => hub.router).map((hub) => ({
    id: hub.id,
    label: hub.label,
    url: hub.url,
    usage: Boolean(hub.managementKey),
    engines: routerEngines(instances, hub.id).map((instanceId) => ({
      instanceId, engine: engineOf(instances[instanceId]), models: modelsOf(instances[instanceId]).length,
    })),
  }));
}

/** Adds each Router engine's Router to the engine list. */
export function withRouterInfo(described: unknown, configs: InstanceConfigMap, hubs: UsageHub[]): unknown {
  if (!Array.isArray(described)) return described;
  const labels = new Map(hubs.map((hub) => [hub.id, hub.label]));
  return described.map((instance: { instanceId?: string }) => {
    const id = instance.instanceId ? routerIdOf(configs[instance.instanceId]) : null;
    const info: InstanceRouterInfo | null = id ? { router: { id, label: labels.get(id) ?? configs[instance.instanceId!].displayName ?? "Router" } } : null;
    return info ? { ...instance, ...info } : instance;
  });
}
