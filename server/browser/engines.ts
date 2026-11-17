// The bots' browser: OpenMausBot's own Chrome driver. A session's spec names the profile it drives; everything that
// reaches a browser goes through the runtime and the live views here.
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { FillLoginDeps } from "../login-fill.ts";
import { LocalBackend } from "./backends.ts";
import { chromeSandbox } from "./chrome/host-setup.ts";
import type { HostKind } from "./chrome/flags.ts";
import { ChromeLauncher } from "./chrome/launcher.ts";
import { ProcessRegistry, sweep } from "./chrome/processes.ts";
import { browserRoot } from "./chrome/profile.ts";
import { browserLanguage, browserTimeZone, languageList } from "./chrome/environment.ts";
import { displayScreen } from "./display.ts";
import type { Download } from "./cdp/downloads.ts";
import { BrowserService, type BrowserTarget } from "./service.ts";
import { LiveV1, type LiveOpenOptions } from "./viewers/live-v1.ts";
import { StreamV2, type StreamRequest } from "./viewers/stream-v2.ts";

/** A spec's command; its one argument is the profile key. */
export const CHROME_ENGINE = "omb-cdp";

/** How a bot's browser session is started: the engine's command with the profile key as its one argument. */
export interface BrowserSpawnSpec {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
}

type Spec = Pick<BrowserSpawnSpec, "command" | "env"> & { args?: readonly string[] };

export function chromeTarget(session: string, spec: { command: string; args?: readonly string[] } | undefined): BrowserTarget | null {
  const key = spec?.command === CHROME_ENGINE ? spec.args?.[0] : undefined;
  return key ? { session, key } : null;
}

/** The profile a bot's browser is: its own, a shared one, or a temporary one. */
export function profileKey(botId: string, session: string, profile: { guest: boolean; partitionId: string | null }): string {
  if (profile.guest) return `temp:${session}`;
  return profile.partitionId ? `shared:${profile.partitionId}` : `bot:${botId}`;
}

const MAX_RUNNING: Record<HostKind, number> = { desktop: 6, server: 4, container: 2 };
const SWEEP_MS = 60_000;

export interface ChromeEngineOptions {
  dataDir: string;
  host: HostKind;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  egressPort(key: string): Promise<number>;
  idleMs(): number;
  held?(session: string): boolean;
  egressNotice(key: string): string | null;
  language?(): string | undefined;
  log?: (line: string) => void;
}

/** The engine: one Chrome launcher, the browser service, its live views and its sweep. */
export class ChromeEngine {
  readonly launcher: ChromeLauncher;
  readonly service: BrowserService;
  readonly live: LiveV1;
  readonly stream: StreamV2;
  readonly #targets = new Map<string, string>();
  readonly #registry: ProcessRegistry;
  readonly #options: ChromeEngineOptions;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ChromeEngineOptions) {
    this.#options = options;
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const sandbox = chromeSandbox(env);
    this.launcher = new ChromeLauncher({ dataDir: options.dataDir, env, platform, sandbox, ...(options.log ? { log: options.log } : {}) });
    this.#registry = new ProcessRegistry(browserRoot(options.dataDir));
    let screen: ReturnType<typeof displayScreen> | null = null;
    const locale = () => browserLanguage(env, options.language?.()) ?? null;
    const backend = new LocalBackend({
      dataDir: options.dataDir,
      host: options.host,
      platform,
      binary: async () => {
        const binary = await this.launcher.binary();
        return { path: binary.path, identity: { ...binary.identity, product: binary.product } };
      },
      screen: () => (screen ??= displayScreen(options.host, { platform, env })),
      locale,
      acceptLanguages: () => languageList(locale() ?? undefined),
      timezone: () => browserTimeZone(env, platform) ?? null,
      egressPort: (key) => options.egressPort(key),
      registry: this.#registry,
      sandbox,
      ...(options.log ? { log: options.log } : {}),
    });
    const maxRunning = Number(env.OMB_BROWSER_MAX_RUNNING) || MAX_RUNNING[options.host];
    this.service = new BrowserService({
      dataDir: options.dataDir,
      backend: () => backend,
      maxRunning,
      idleMs: options.idleMs,
      held: options.held,
      egressNotice: options.egressNotice,
      ...(options.log ? { log: options.log } : {}),
    });
    this.live = new LiveV1({ service: this.service, target: (session) => this.target(session) });
    this.stream = new StreamV2({ service: this.service });
  }

  /** The spec a session gets on the new engine, remembered so its live view finds the profile. */
  spec(session: string, key: string): { command: string; args: string[]; env: Record<string, string> } {
    this.#targets.set(session, key);
    return { command: CHROME_ENGINE, args: [key], env: {} };
  }

  target(session: string): BrowserTarget | null {
    const key = this.#targets.get(session);
    return key ? { session, key } : null;
  }

  /** Prepares Chrome before a bot needs it when the browser is on, and every minute closes idle browsers and stray processes. */
  start({ prepare }: { prepare: boolean }): void {
    if (prepare && this.launcher.plan().kind !== "none") void this.launcher.prepare();
    if (this.#timer) return;
    this.#tick();
    this.#timer = setInterval(() => this.#tick(), SWEEP_MS);
    this.#timer.unref?.();
  }

  #tick(): void {
    void this.service.closeIdle().catch(() => undefined);
    void sweep({ root: browserRoot(this.#options.dataDir), registry: this.#registry }).catch(() => undefined);
  }

  /** Whether the engine ever made a profile in this data folder. */
  #everUsed(): boolean {
    const root = browserRoot(this.#options.dataDir);
    return existsSync(join(root, "profiles")) || existsSync(join(root, "temp"));
  }

  async close(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.live.closeAll();
    this.stream.closeAll();
    await this.service.closeAll();
  }

  /** A deleted bot's or profile's browser: stopped, and its folder, downloads and screenshots gone. */
  async erase(request: { kind: "bot" | "profile"; id: string; partitionId: string }): Promise<boolean> {
    const key = request.kind === "bot" ? `bot:${request.id}` : `shared:${request.partitionId}`;
    if (!this.#everUsed()) return true;
    try {
      await this.service.erase(key);
      return true;
    } catch (error) {
      this.#options.log?.(`browser cleanup: could not erase ${key}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /** For the browser status: the Chrome this server runs, or why it has none. */
  summary(): { kind: "engine"; version: string; chrome: string } | { kind: "unavailable"; reason: string; installChrome?: true } {
    const plan = this.launcher.plan();
    if (plan.kind === "none") return { kind: "unavailable", reason: plan.reason, ...(plan.installChrome ? { installChrome: true as const } : {}) };
    const problem = this.launcher.hostProblem();
    if (problem) return { kind: "unavailable", reason: `Chrome could not be started: ${problem}` };
    return { kind: "engine", version: CHROME_ENGINE, chrome: this.launcher.describe() };
  }

  /** fill_card's reads and typing: it types into a payment provider's frame and keeps it out of screenshots. */
  cardDeps(session: string): ReturnType<BrowserService["cardDeps"]> | null {
    const target = this.target(session);
    return target ? this.service.cardDeps(target) : null;
  }

  /** fill_login's reads and typing. */
  loginDeps(session: string): Pick<FillLoginDeps, "engine" | "insertText" | "press" | "click"> | null {
    const target = this.target(session);
    return target ? this.service.loginDeps(target) : null;
  }
}

export interface BrowserRuntimeOptions {
  /** What a tool call is told instead of reaching the browser, or null to run it. */
  refusal?(params: unknown): string | null;
  /** A tool call's answer as the bot gets it. */
  annotate?(result: unknown): unknown;
}

const NOT_STARTED = "This browser was not started by OpenMausBot's browser engine. Call again: the next call starts it.";

/** The bots' browser calls, each going to the session's profile. */
export class BrowserRuntime {
  readonly #chrome: ChromeEngine;
  readonly #refusal: BrowserRuntimeOptions["refusal"];
  readonly #annotate: BrowserRuntimeOptions["annotate"];

  constructor(chrome: ChromeEngine, options: BrowserRuntimeOptions = {}) {
    this.#chrome = chrome;
    this.#refusal = options.refusal;
    this.#annotate = options.annotate;
  }

  async agentRpc(session: string, spec: Spec, method: "tools/list" | "tools/call", params: unknown, beforeDispatch?: () => void): Promise<unknown> {
    const refusal = method === "tools/call" ? this.#refusal?.(params) : null;
    if (refusal) return { isError: true, content: [{ type: "text", text: refusal }] };
    const target = chromeTarget(session, spec);
    if (!target) return { isError: true, content: [{ type: "text", text: NOT_STARTED }] };
    const result = await this.#chrome.service.agentRpc(target, method, params, beforeDispatch);
    return method === "tools/call" && this.#annotate ? this.#annotate(result) : result;
  }

  previewFrame(session: string): Promise<{ png: string; format: "jpeg" }> {
    return this.#chrome.service.previewFrame(session);
  }

  withSecretInput<T extends { ok: boolean; text: string; held?: { url: string; ms: number } }>(session: string, spec: Spec, fn: () => Promise<T>): Promise<T> {
    const target = chromeTarget(session, spec);
    if (!target) return Promise.resolve({ ok: false, text: NOT_STARTED } as T);
    return this.#chrome.service.withSecretInput(target, fn);
  }

  heldBy(session: string): string | null { return this.#chrome.service.heldBy(session); }
  working(session: string): boolean { return this.#chrome.service.working(session); }
  interrupted(session: string): boolean { return this.#chrome.service.interrupted(session); }
  interruptedCount(): number { return this.#chrome.service.interruptedCount(); }
  runs(session: string): boolean { return this.#chrome.service.runs(session); }

  /** Closes a session's browser now unless a call, an agent or a person is using it. */
  closeUnused(session: string): Promise<boolean> {
    return this.#chrome.service.closeUnused(session);
  }

  close(session: string): Promise<void> {
    return this.#chrome.service.close(session);
  }

  closeAll(): Promise<void> {
    return this.#chrome.close();
  }
}

type SessionSpec = { session: string; spec: { command: string; args?: readonly string[] } };

/** The live views of the bots' browsers: v1 frames for older panels and phones, and the v2 stream with its file pickers
 * and downloads. */
export class BrowserLive {
  readonly #chrome: ChromeEngine;

  constructor(chrome: ChromeEngine) {
    this.#chrome = chrome;
  }

  open({ spec: _spec, ...options }: LiveOpenOptions & { spec?: unknown; resume?: string | null }): Promise<void> {
    return this.#chrome.live.open(options);
  }

  action(options: { viewerId: string; botId: string; owner: string; body: unknown }): Promise<unknown> {
    return this.#chrome.live.action(options);
  }

  /** False when the session's spec names no profile. */
  stream({ session, spec, ...request }: SessionSpec & Omit<StreamRequest, "target">): boolean {
    const target = chromeTarget(session, spec);
    if (!target) return false;
    this.#chrome.stream.open({ ...request, target });
    return true;
  }

  fileChooserOffered({ session }: SessionSpec, owner: string, chooserId: string): boolean {
    return this.#chrome.service.fileChooserOffered(session, owner, chooserId);
  }

  answerFileChooser({ session }: SessionSpec, owner: string, chooserId: string, paths: readonly string[]): Promise<boolean> {
    return this.#chrome.service.answerFileChooser(session, owner, chooserId, paths);
  }

  download({ session }: SessionSpec, id: string): Download | undefined {
    return this.#chrome.service.download(session, id);
  }

  handBack(session: string): void { this.#chrome.live.handBack(session); }
  closeForSession(session: string): void { this.#chrome.live.closeForSession(session); this.#chrome.stream.closeForSession(session); }
  closeForOwner(owner: string): void { this.#chrome.live.closeForOwner(owner); this.#chrome.stream.closeForOwner(owner); }
  closeForBot(botId: string): void { this.#chrome.live.closeForBot(botId); this.#chrome.stream.closeForBot(botId); }
  closeAll(): void { this.#chrome.live.closeAll(); this.#chrome.stream.closeAll(); }
  /** Who may see what changed: every v2 view that no longer shows its browser to a person allowed to see it closes now. */
  recheck(): void { this.#chrome.stream.recheck(); }
}
