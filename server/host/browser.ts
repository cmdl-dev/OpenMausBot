// The bots' browser as the server hosts it: OpenMausBot's Chrome engine and its live views, which session a bot's
// browser is, and the integration a turn mounts.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { Audience } from "../audience.ts";
import type { CloudLendingRefusal } from "../cloud-lending.ts";
import type { AppConfig } from "../config.ts";
import { browserProfilePartitionId, browserProfilePartitionTarget, builtInBrowserEnabled, DATA_DIR } from "../config.ts";
import { browserEgress, type EgressSetup } from "../browser/egress/registry.ts";
import { browserIdleMs, type BrowserCleanupWireRequest } from "../browser-lifecycle-cleanup.ts";
import { AudienceBrowsers, audienceBrowserSuffix } from "../browser/audience.ts";
import { namedUploadPaths } from "../browser-upload.ts";
import type { HostKind } from "../browser/chrome/flags.ts";
import { parseSocks5Proxy } from "../browser/egress/policy.ts";
import { BrowserLive, BrowserRuntime, ChromeEngine, chromeTarget, profileKey } from "../browser/engines.ts";
import { removeOldEngineFiles } from "../browser/old-engine-cleanup.ts";
import { CHROME_BROWSER_SYSTEM_PROMPT } from "../browser/prompt.ts";
import { passkeyAnnotation } from "../browser/passkey-notice.ts";
import { browserSessionId } from "../browser/session-names.ts";
import type { EngineBrowsers } from "../engine-memory.ts";
import { harnessMcpTokenEnv } from "../harness-mcp-token.ts";
import type { FillLoginDeps } from "../login-fill.ts";
import { AGENTS_NODE_FLAG, SPAWNED_PROXIES } from "../proxy-paths.ts";
import type { Store } from "../store.ts";
import type { TurnOwner, TurnResources } from "../turn-resources.ts";

export interface BrowserHostDeps {
  cfg: AppConfig;
  /** Current application language for every built-in browser launch. */
  language?(): string | undefined;
  /** The store is built after this host, so it is read when used. */
  store(): Pick<Store, "bots" | "bot" | "botByThread">;
  turnResources: Pick<TurnResources, "free" | "holder">;
  mintInternalCapability(capability: {
    botId: string; threadId: string; generation: string; browserSession: string; kind: "browser";
    depth: number; skillAuthoring: boolean; createdBots: number; openedThreads: number;
  }): string;
  DESKTOP_MANAGED: boolean;
  CLOUD_HOME: unknown;
  /** A shared company workspace: the server's network is the operator's, so the stored local-sites switch and allow-list are ignored. */
  HOSTED_WORKSPACE?: boolean;
  PORT: number;
  /** A Cloud home's way out through the person's own lent computer. */
  device?: EgressSetup["device"];
  /** Why a turn may not use the person's lent computer (cloud-lending.ts plus the memory check), or null when it may.
   * Without it, no browser a turn holds may. */
  lendRefusal?(turn: TurnOwner): LendRefusal | null;
  /** The engine memory guard, told which browsers each thread's turn starts or holds. */
  engineMemory?: { useBrowsers(browsers: EngineBrowsers): void };
  /** Whose browser a conversation's turns use on a Team Cloud: the member's, the group chat's or the team's. Every
   * browser is the bot's own without it. */
  audienceOf?(threadId: string): Audience;
}

/** The lent computer's connection for a browser's pages, under the rule for everything it lends: only while the last
 * turn to hold that browser may use the lent computer. A browser no turn has held is the person's own. */
function lentDevice(device: NonNullable<EgressSetup["device"]>, holder: (session: string) => TurnOwner | undefined, mayLend: (turn: TurnOwner) => boolean) {
  const lends = new Map<string, boolean>();
  return (session: string) => {
    const turn = holder(session);
    if (turn) lends.set(session, mayLend(turn));
    return lends.get(session) === false ? null : device(session);
  };
}

type Spec = { command: string; args?: readonly string[]; env: Record<string, string> };
type LendRefusal = CloudLendingRefusal | "memory-changed" | "memory-changed-here";

export function createBrowserHost(deps: BrowserHostDeps) {
  const { cfg, turnResources, mintInternalCapability, DESKTOP_MANAGED, CLOUD_HOME, PORT } = deps;
  const store: Pick<Store, "bots" | "bot" | "botByThread"> = { get bots() { return deps.store().bots; }, bot: (id: string) => deps.store().bot(id),
    botByThread: (threadId: string) => deps.store().botByThread(threadId) };

  const host: HostKind = DESKTOP_MANAGED ? "desktop" : CLOUD_HOME || existsSync("/.dockerenv") ? "container" : "server";
  const idleMs = () => browserIdleMs(cfg, { cloudHome: Boolean(CLOUD_HOME) });
  const chromeEngine = new ChromeEngine({
    dataDir: DATA_DIR,
    host,
    egressPort: (key) => browserEgress.open(key),
    egressNotice: (key) => browserEgress.takeNotice(key),
    idleMs,
    language: deps.language,
    held: (session) => !turnResources.free(`browser:${session}`),
    log: (line) => console.warn(line),
  });
  const lendRefusal = deps.lendRefusal ?? ((): LendRefusal => "unproven");
  const mayLend = (turn: TurnOwner) => lendRefusal(turn) === null;
  // A tool call that would open Reddit from MausBot Cloud is refused before it reaches the browser.
  const browserRuntime = new BrowserRuntime(chromeEngine, {
    refusal: (params) => browserEgress.callRefusal(params),
    annotate: passkeyAnnotation(CLOUD_HOME ? "cloud" : DESKTOP_MANAGED ? "desktop" : "server"),
  });
  const browserLive = new BrowserLive(chromeEngine);
  const usedBrowserSessions = new Map<string, Spec>();
  const audiences = new AudienceBrowsers(join(DATA_DIR, "browser", "audiences.json"));
  const browserAudience = (threadId: string | undefined): Audience => (threadId && deps.audienceOf ? deps.audienceOf(threadId) : "team");
  const device = deps.device && lentDevice(deps.device, (session) => turnResources.holder(`browser:${session}`), mayLend);
  const egressHost = DESKTOP_MANAGED ? "desktop" : CLOUD_HOME ? "cloud" : "server";
  // Self-hosted servers only: the owner's switch for this server's own sites and its local network. A shared company
  // workspace's network is the operator's, so its stored switch and allow-list are ignored, like MausBot Cloud's.
  const hostedServer = egressHost === "server" && Boolean(deps.HOSTED_WORKSPACE);
  const sitesSwitch = egressHost === "server" && !hostedServer;
  browserEgress.configure({ host: egressHost, config: () => (hostedServer ? undefined : cfg.browserEngine?.egress), ...(device ? { device } : {}) });
  const browserSweep = {
    start() {
      removeOldEngineFiles({ dataDir: DATA_DIR });
      chromeEngine.start({ prepare: false });
      return browserSweep;
    },
    /** Finds or downloads Chrome and reads its identity before a bot needs it. */
    prepare: () => chromeEngine.start({ prepare: true }),
    closeAll: () => browserRuntime.closeAll(),
  };
  // The viewer and the agent must address the SAME temporary browser.
  const temporaryBrowserSessions = new Map<string, string>();
  /** The suffix an audience gives a browser's name, remembered so a deletion erases every audience's browser. */
  function noted(audience: Audience): string {
    const suffix = audienceBrowserSuffix(audience);
    audiences.note(suffix);
    return suffix;
  }
  function sessionFor(botId: string, profile: string | undefined, suffix: string): string {
    if (profile === "guest") {
      const key = botId + suffix;
      let session = temporaryBrowserSessions.get(key);
      if (!session) {
        session = browserSessionId(key, "guest");
        temporaryBrowserSessions.set(key, session);
      }
      return session;
    }
    const target = profile ? browserProfilePartitionTarget(cfg, profile) : null;
    return browserSessionId(botId + suffix, target ? target.partitionId + suffix : "");
  }
  function currentBrowserSession(botId: string, profile: string | undefined, audience: Audience = "team"): string {
    return sessionFor(botId, profile, noted(audience));
  }
  /** Every audience's browser of a bot as it is named now; a temporary one only once it started. */
  function browserSessionsOf(botId: string, profile: string | undefined): string[] {
    return audiences.variants().flatMap((suffix) => {
      if (profile !== "guest") return [sessionFor(botId, profile, suffix)];
      const session = temporaryBrowserSessions.get(botId + suffix);
      return session ? [session] : [];
    });
  }
  async function forgetTemporaryBrowser(botId: string): Promise<void> {
    await Promise.all(audiences.variants().map((suffix) => forgetTemporaryKey(botId + suffix)));
  }
  async function forgetTemporaryKey(key: string): Promise<void> {
    const session = temporaryBrowserSessions.get(key);
    if (!session) return;
    temporaryBrowserSessions.delete(key);
    usedBrowserSessions.delete(session);
    await chromeEngine.service.close(session);
  }
  function chromeSpec(botId: string, profile: string | undefined, audience: Audience): { session: string; spec: ReturnType<ChromeEngine["spec"]> } {
    const suffix = noted(audience);
    const session = sessionFor(botId, profile, suffix);
    const target = profile && profile !== "guest" ? browserProfilePartitionTarget(cfg, profile) : null;
    return { session, spec: chromeEngine.spec(session, profileKey(botId + suffix, session, { guest: profile === "guest", partitionId: target ? target.partitionId + suffix : null })) };
  }
  /** Whether this server has a Chrome for the bots' browser. */
  function browserReady(): boolean {
    return chromeEngine.summary().kind === "engine";
  }
  function turnIntegration(botId: string, session: string, turn: { threadId: string; generation: string }) {
    const token = mintInternalCapability({ botId, ...turn, browserSession: session,
      kind: "browser", depth: 0, skillAuthoring: false, createdBots: 0, openedThreads: 0 });
    return {
      command: process.execPath, args: [SPAWNED_PROXIES.harnessMcp, "browser"], env: {
        ...AGENTS_NODE_FLAG, [harnessMcpTokenEnv("browser")]: token, OMB_HARNESS_URL: `http://127.0.0.1:${PORT}`,
      },
    };
  }
  type Integration = { command: string; args: string[]; env: Record<string, string> };
  /** Null is never returned today; callers keep handling it for a browser that cannot be named. */
  async function browserIntegration(botId: string, profile: string | undefined, turn?: { threadId: string; generation: string }, audience = browserAudience(turn?.threadId)): Promise<{ profile: string; session: string; spec: ReturnType<ChromeEngine["spec"]>; integration: Integration } | null> {
    const profileTarget = profile && profile !== "guest" ? browserProfilePartitionTarget(cfg, profile) : null;
    const partitionId = profile === "guest" ? "guest" : (profileTarget?.partitionId ?? "");
    const { session, spec } = chromeSpec(botId, profile, audience);
    usedBrowserSessions.set(session, spec);
    return { profile: partitionId, session, spec, integration: turn ? turnIntegration(botId, session, turn) : spec };
  }
  /** A bot's browser as it runs or would run now, without starting it. */
  async function currentBrowserSpec(botId: string, profile: string | undefined, audience: Audience = "team"): Promise<{ session: string; spec: Spec }> {
    return chromeSpec(botId, profile, audience);
  }
  /** fill_login's reads and typing. */
  function loginInput(session: string, _spec: Spec): Pick<FillLoginDeps, "engine" | "insertText" | "press" | "click"> {
    const input = chromeEngine.loginDeps(session);
    if (!input) throw new Error("This browser is not open yet. Open the site's sign-in page in it first, then call fill_login.");
    return input;
  }
  /** fill_card's reads and typing. */
  function cardInput(session: string) {
    return chromeEngine.cardDeps(session);
  }
  function browserSystemPrompt(): string {
    return CHROME_BROWSER_SYSTEM_PROMPT;
  }
  async function closeBrowser(session: string, spec: Spec): Promise<boolean> {
    if (!chromeTarget(session, spec)) return true;
    await chromeEngine.service.close(session);
    return true;
  }
  /** The browser a thread's bot would start; a temporary one has no session until its first call. */
  function threadBrowser(threadId: string): { session: string | undefined; spec: Spec | undefined } | null {
    const bot = store.botByThread(threadId);
    if (!bot || bot.browser === false || bot.computer === "off" || !builtInBrowserEnabled(cfg)) return null;
    const audience = browserAudience(threadId);
    const session = bot.browserProfile === "guest" ? temporaryBrowserSessions.get(bot.id + audienceBrowserSuffix(audience)) : currentBrowserSession(bot.id, bot.browserProfile, audience);
    return { session, spec: session === undefined ? undefined : usedBrowserSessions.get(session) };
  }
  /** Tried until no turn holds the browser and no call runs in it, or for 30 s: the stopped turn may still be settling. */
  async function closeForMemory(session: string): Promise<void> {
    for (let attempt = 0; attempt < 15 && browserRuntime.runs(session); attempt++) {
      if (turnResources.free(`browser:${session}`) && await browserRuntime.closeUnused(session)) {
        console.info(`browser ${session}: closed to free memory after its bot was stopped`);
        return;
      }
      await sleep(2_000);
    }
  }
  const engineBrowsers: EngineBrowsers = {
    starts: (threadId) => {
      const browser = threadBrowser(threadId);
      return browser !== null && (browser.session === undefined || !browserRuntime.runs(browser.session));
    },
    which: (threadId) => threadBrowser(threadId)?.session,
    running: (threadId) => {
      const browser = threadBrowser(threadId);
      return browser?.session !== undefined && browserRuntime.runs(browser.session);
    },
    stopped: (threadId) => {
      const browser = threadBrowser(threadId);
      if (browser?.session !== undefined) void closeForMemory(browser.session);
    },
  };
  deps.engineMemory?.useBrowsers(engineBrowsers);
  /** A deleted bot's or profile's browser, for every audience: stopped and its profile folder erased; true once that is done. */
  async function eraseDeletedBrowser(request: BrowserCleanupWireRequest): Promise<boolean> {
    const results = await Promise.all(audiences.variants().map((suffix) => eraseOneBrowser({
      ...request, ...(request.botId ? { botId: request.botId + suffix } : {}), ...(request.partitionId ? { partitionId: request.partitionId + suffix } : {}),
    })));
    return results.every(Boolean);
  }
  function eraseOneBrowser(request: BrowserCleanupWireRequest): Promise<boolean> {
    if (request.type === "openmausbot:browser-bot-deleted" && request.botId) return chromeEngine.erase({ kind: "bot", id: request.botId, partitionId: "" });
    if (request.partitionId) return chromeEngine.erase({ kind: "profile", id: request.partitionId, partitionId: request.partitionId });
    return Promise.resolve(true);
  }
  /** A person who left a Team Cloud: their own browser of every bot and every shared profile, stopped and its profile
   * folder erased. True once that is done. */
  async function eraseAudienceBrowsers(audience: Audience): Promise<boolean> {
    const suffix = audienceBrowserSuffix(audience);
    if (!suffix || !audiences.variants().includes(suffix)) return true;
    const requests: BrowserCleanupWireRequest[] = [
      ...store.bots.map((bot) => ({ type: "openmausbot:browser-bot-deleted" as const, requestId: "team-member-left", botId: bot.id + suffix })),
      ...(cfg.browserProfiles ?? []).map((profile) => ({
        type: "openmausbot:browser-profile-deleted" as const, requestId: "team-member-left", partitionId: browserProfilePartitionId(profile) + suffix })),
    ];
    return (await Promise.all(requests.map((request) => eraseOneBrowser(request)))).every(Boolean);
  }
  /** Chrome receives private copies of each file. */
  function uploadPaths(files: ReadonlyArray<{ file: string; name: string | null }>): Promise<string[]> {
    return namedUploadPaths(files, join(DATA_DIR, "browser-uploads"), Date.now(), { everyFile: true });
  }
  /** What Settings shows of the browser that runs bots' pages here. */
  function engineSummary() {
    const serverSites = sitesSwitch ? { serverSites: cfg.browserEngine?.egress?.localNetwork === true } : {};
    const proxyValue = cfg.browserEngine?.egress?.proxy;
    const proxySaved = typeof proxyValue === "string" && proxyValue.trim().length > 0;
    const proxyConfigured = builtInBrowserEnabled(cfg) && !hostedServer && parseSocks5Proxy(proxyValue) !== null;
    return {
      ...chromeEngine.summary(),
      ...serverSites,
      ...(proxyConfigured ? { proxyConfigured: true } : {}),
      ...(proxySaved ? { proxySaved: true } : {}),
    };
  }

  return {
    browserRuntime, browserLive, usedBrowserSessions, browserSweep, temporaryBrowserSessions, browserIdleMs: idleMs,
    currentBrowserSession, forgetTemporaryBrowser, browserIntegration,
    browserReady, currentBrowserSpec, loginInput, cardInput, browserSystemPrompt, closeBrowser,
    eraseDeletedBrowser, engineSummary, engineBrowsers, browserAudience, browserSessionsOf, uploadPaths,
    eraseAudienceBrowsers,
  };
}
