import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHROME_BROWSER_SYSTEM_PROMPT } from "../browser/prompt.ts";
import { LocalBackend } from "../browser/backends.ts";
import { FakeBackend } from "../browser/testing/fake-chrome.ts";
import { TOOL_LIST } from "../browser/tools.ts";
import { browserEgress } from "../browser/egress/registry.ts";
import { REDDIT_REFUSAL } from "../browser/egress/reddit.ts";
import type { Audience } from "../audience.ts";
import { DATA_DIR, type AppConfig } from "../config.ts";
import type { Store } from "../store.ts";
import { TurnResources, type TurnOwner } from "../turn-resources.ts";
import { audienceBrowserSuffix } from "../browser/audience.ts";
import { ChromeEngine } from "../browser/engines.ts";
import type { CdpSession, Params } from "../browser/cdp/connection.ts";
import { FileChoosers } from "../browser/cdp/files.ts";
import { uploadableFiles } from "../browser-upload.ts";
import { createBrowserHost, type BrowserHostDeps } from "./browser.ts";

type Host = ReturnType<typeof createBrowserHost>;
const hosts: Host[] = [];
// A named Chrome, so the host has a bots' browser on every runner; these checks never start it.
beforeEach(() => { vi.stubEnv("OMB_CHROME_PATH", process.execPath); });
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(hosts.splice(0).map((host) => host.browserRuntime.closeAll())); });

const turn = { threadId: "thread-1", generation: "gen-1" };

function setup({ cloudHome = false, server = false, hosted = false, device, lendRefusal, holder, audienceOf, bots: botIds = ["scout"], turnResources }: {
  cloudHome?: boolean; server?: boolean; hosted?: boolean; device?: BrowserHostDeps["device"]; lendRefusal?: BrowserHostDeps["lendRefusal"]; holder?: (resource: string) => TurnOwner | undefined;
  audienceOf?: BrowserHostDeps["audienceOf"]; bots?: string[]; turnResources?: BrowserHostDeps["turnResources"];
} = {}) {
  const cfg = {
    features: { browser: true },
    browserProfiles: [
      { id: "work", name: "Work", partitionId: "p-work" },
      { id: "mine", name: "Mine", partitionId: "p-mine" },
    ],
  } as unknown as AppConfig;
  const bots = botIds.map((id) => ({ id, name: id, browser: true }));
  const minted: unknown[] = [];
  const host = createBrowserHost({
    cfg,
    store: () => ({ bots, bot: (id: string) => bots.find((bot) => bot.id === id), botByThread: () => bots[0] }) as unknown as Pick<Store, "bots" | "bot" | "botByThread">,
    turnResources: turnResources ?? { free: () => true, holder: holder ?? (() => undefined) },
    mintInternalCapability: (capability) => { minted.push(capability); return "capability-token"; },
    DESKTOP_MANAGED: !cloudHome && !server,
    CLOUD_HOME: cloudHome ? { machineId: "m-1" } : null,
    HOSTED_WORKSPACE: hosted,
    PORT: 4100,
    device,
    lendRefusal,
    audienceOf,
  });
  hosts.push(host);
  return { cfg, host, minted, bots };
}

describe("the bots' browser host and the engine memory guard", () => {
  it("hands the guard the browsers each thread's turn starts or holds", () => {
    const told: unknown[] = [];
    const host = createBrowserHost({
      cfg: { features: { browser: true } } as unknown as AppConfig,
      store: () => ({ bots: [], bot: () => undefined, botByThread: () => undefined }) as unknown as Pick<Store, "bots" | "bot" | "botByThread">,
      turnResources: { free: () => true, holder: () => undefined },
      mintInternalCapability: () => "capability-token",
      DESKTOP_MANAGED: false,
      CLOUD_HOME: { machineId: "m-1" },
      PORT: 4100,
      engineMemory: { useBrowsers: (browsers) => { told.push(browsers); } },
    });
    hosts.push(host);
    expect(told).toEqual([host.engineBrowsers]);
  });
});

describe("the bots' browser host", () => {
  it("keeps Chrome open between browser calls until the host's whole-turn claim is released", async () => {
    const backend = new FakeBackend();
    const open = vi.spyOn(LocalBackend.prototype, "open").mockImplementation((request) => backend.open(request));
    try {
      const resources = new TurnResources();
      const { host } = setup({ turnResources: resources });
      const browser = (await host.browserIntegration("scout", undefined, turn))!;
      const result = await host.browserRuntime.agentRpc(browser.session, browser.spec, "tools/call", { name: "agent_browser_status", arguments: {} }, () => {
        expect(resources.claim(`browser:${browser.session}`, turn)).toBe(true);
      });
      expect(result).not.toHaveProperty("isError", true);
      expect(await host.browserRuntime.closeUnused(browser.session)).toBe(false);
      resources.release(turn);
      expect(await host.browserRuntime.closeUnused(browser.session)).toBe(true);
    } finally {
      open.mockRestore();
    }
  });

  it("gives a bot's turn the browser MCP server over its own profile", async () => {
    const { host, minted } = setup();
    const browser = await host.browserIntegration("scout", undefined, turn);
    expect(browser?.spec).toEqual({ command: "omb-cdp", args: ["bot:scout"], env: {} });
    expect(browser?.integration).toMatchObject({ command: process.execPath, env: { OMB_HARNESS_URL: "http://127.0.0.1:4100" } });
    expect(minted).toEqual([expect.objectContaining({ botId: "scout", browserSession: browser?.session, kind: "browser", ...turn })]);
    expect(host.usedBrowserSessions.get(browser!.session)).toEqual(browser?.spec);
  });

  it("puts a shared profile's bots on one profile and a temporary browser on its own", async () => {
    const { host } = setup();
    expect((await host.browserIntegration("scout", "work"))?.spec.args).toEqual(["shared:p-work"]);
    const guest = await host.browserIntegration("scout", "guest");
    expect(guest?.spec.args).toEqual([`temp:${guest?.session}`]);
  });

  it("lists the browser's tools without starting Chrome", async () => {
    const { host } = setup();
    const browser = await host.browserIntegration("scout", undefined, turn);
    const listed = await host.browserRuntime.agentRpc(browser!.session, browser!.spec as never, "tools/list", {}) as { tools: Array<{ name: string }> };
    expect(listed.tools.map((tool) => tool.name)).toEqual(TOOL_LIST.map((tool) => tool.name));
  });

  it("runs every profile on OpenMausBot's Chrome, a former My Chrome profile on its own profile too", async () => {
    const { host } = setup();
    expect(host.browserSystemPrompt()).toBe(CHROME_BROWSER_SYSTEM_PROMPT);
    expect((await host.browserIntegration("scout", "mine"))?.spec).toEqual({ command: "omb-cdp", args: ["shared:p-mine"], env: {} });
  });

  it("reports saved and active proxy status", () => {
    const { cfg, host } = setup();
    cfg.browserEngine = { egress: { proxy: "socks5://127.0.0.1:1080" } };
    expect(host.engineSummary()).toMatchObject({ proxySaved: true, proxyConfigured: true });
    cfg.browserEngine = { egress: { proxy: "invalid" } };
    expect(host.engineSummary()).toMatchObject({ proxySaved: true });
    expect(host.engineSummary().proxyConfigured).toBeUndefined();
    cfg.features!.browser = false;
    cfg.browserEngine = { egress: { proxy: "socks5://127.0.0.1:1080" } };
    expect(host.engineSummary()).toMatchObject({ proxySaved: true });
    expect(host.engineSummary().proxyConfigured).toBeUndefined();
  });

  it("refuses a call that would open Reddit from MausBot Cloud before it reaches Chrome", async () => {
    const { host } = setup({ cloudHome: true });
    const browser = (await host.browserIntegration("scout", undefined, turn))!;
    const open = vi.spyOn(LocalBackend.prototype, "open");
    expect(await host.browserRuntime.agentRpc(browser.session, browser.spec, "tools/call", { name: "agent_browser_open", arguments: { url: "https://www.reddit.com/" } }))
      .toEqual({ isError: true, content: [{ type: "text", text: REDDIT_REFUSAL }] });
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("offers the owner's local-sites switch on a self-hosted server, but never on a shared company workspace", () => {
    for (const hosted of [false, true]) {
      const { cfg, host } = setup({ server: true, hosted });
      cfg.browserEngine = { egress: { localNetwork: true, allow: ["10.0.0.5"] } };
      expect(host.engineSummary().serverSites).toBe(hosted ? undefined : true);
      expect(browserEgress.rules().localNetwork).toBe(!hosted);
      expect(browserEgress.rules().allowed("10.0.0.5", 80)).toBe(!hosted);
    }
    const desktop = setup();
    desktop.cfg.browserEngine = { egress: { allow: ["10.0.0.5"] } };
    expect(desktop.host.engineSummary().serverSites).toBeUndefined();
    // The desktop's own default stays: its browsers reach the local network unless egress.localNetwork is false.
    expect(browserEgress.rules().localNetwork).toBe(true);
  });
});

describe("what the memory guard sees of a bot's browser", () => {
  it("counts a browser a bot's turn may start, but not one it can't use", () => {
    const { host, bots } = setup({ cloudHome: true });
    const bot = bots[0] as { browser: boolean; browserProfile?: string };
    expect(host.engineBrowsers.starts("thread-1")).toBe(true);
    bot.browser = false;
    expect(host.engineBrowsers.starts("thread-1")).toBe(false);
  });

  it("counts a temporary browser before its first call without making its session", () => {
    const { host, bots } = setup({ cloudHome: true });
    (bots[0] as { browserProfile?: string }).browserProfile = "guest";
    expect(host.engineBrowsers.starts("thread-1")).toBe(true);
    expect(host.temporaryBrowserSessions.size).toBe(0);
  });

  it("closes nothing for a stopped turn whose bot's browser is not running", async () => {
    const { host } = setup({ cloudHome: true });
    await host.browserIntegration("scout", undefined, turn);
    const closeUnused = vi.spyOn(host.browserRuntime, "closeUnused");
    host.engineBrowsers.stopped("thread-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closeUnused).not.toHaveBeenCalled();
  });
});

describe("the person's lent computer's connection, for a bot's browser on My Cloud", () => {
  it("is offered only while the last turn to hold that browser may use the lent computer", () => {
    const configure = vi.spyOn(browserEgress, "configure");
    const holders = new Map<string, TurnOwner>();
    const upstream = { open: async () => ({ refused: "port" as const }) };
    setup({ cloudHome: true, device: () => upstream, lendRefusal: (turn) => (turn.threadId === "owner-thread" ? null : "someone-else"), holder: (resource) => holders.get(resource) });
    const device = configure.mock.lastCall![0].device!;
    configure.mockRestore();
    expect(device("bot-1"), "a browser no turn has held is the person's own").toBe(upstream);
    holders.set("browser:bot-1", { threadId: "guest-thread", generation: "g1" });
    expect(device("bot-1"), "held by a turn that may not use the lent computer").toBeNull();
    holders.delete("browser:bot-1");
    expect(device("bot-1"), "its pages stay off the computer after that turn ends").toBeNull();
    expect(device("bot-2"), "another browser keeps its own verdict").toBe(upstream);
    holders.set("browser:bot-1", { threadId: "owner-thread", generation: "g2" });
    expect(device("bot-1")).toBe(upstream);
    holders.delete("browser:bot-1");
    expect(device("bot-1"), "and on it after the person's own turn ends").toBe(upstream);
  });

  it("is never offered to a browser a turn holds when the host can't tell who may use the lent computer", () => {
    const configure = vi.spyOn(browserEgress, "configure");
    const upstream = { open: async () => ({ refused: "port" as const }) };
    setup({ cloudHome: true, device: () => upstream, holder: () => ({ threadId: "t", generation: "g" }) });
    const device = configure.mock.lastCall![0].device!;
    configure.mockRestore();
    expect(device("bot-1")).toBeNull();
  });
});

describe("how long an unused browser stays open", () => {
  it("is three minutes on a Cloud home and ten on a desktop, unless config.json sets it", () => {
    const cloud = setup({ cloudHome: true });
    expect(cloud.host.browserIdleMs()).toBe(3 * 60_000);
    cloud.cfg.browserEngine = { idleTimeoutMinutes: 20 };
    expect(cloud.host.browserIdleMs()).toBe(20 * 60_000);
    expect(setup().host.browserIdleMs()).toBe(10 * 60_000);
  });
});

describe("a deleted bot's browser", () => {
  afterEach(() => { vi.restoreAllMocks(); forgetAudiences(); });
  const deleted = { type: "openmausbot:browser-bot-deleted" as const, requestId: "00000000-0000-4000-8000-000000000000", botId: "gone" };

  it("is stopped and its profile erased, and reports whether that worked", async () => {
    const erase = vi.spyOn(ChromeEngine.prototype, "erase").mockResolvedValue(true);
    const { host } = setup({ cloudHome: true });
    expect(await host.eraseDeletedBrowser(deleted)).toBe(true);
    expect(erase.mock.calls.map(([request]) => request)).toEqual([{ kind: "bot", id: "gone", partitionId: "" }]);
    erase.mockResolvedValue(false);
    expect(await host.eraseDeletedBrowser(deleted)).toBe(false);
  });

  it("on a Team Cloud, is erased for every audience it had: each member's, each group chat's and the team's", async () => {
    const erase = vi.spyOn(ChromeEngine.prototype, "erase").mockResolvedValue(true);
    forgetAudiences();
    const { host } = setup({ cloudHome: true, audienceOf: teamAudiences });
    host.currentBrowserSession("gone", undefined, "member:p_ada");
    host.currentBrowserSession("gone", undefined, "room:launch");
    expect(await host.eraseDeletedBrowser(deleted)).toBe(true);
    expect(erase.mock.calls.map(([request]) => request.id)).toEqual(["gone", `gone${ADA}`, `gone${ROOM}`]);
    erase.mockClear();
    // After a restart too: which audiences had browsers is kept on disk.
    const again = setup({ cloudHome: true, audienceOf: teamAudiences });
    expect(await again.host.eraseDeletedBrowser({ ...deleted, type: "openmausbot:browser-profile-deleted", botId: undefined, partitionId: "p-work" })).toBe(true);
    expect(erase.mock.calls.map(([request]) => request.id)).toEqual(["p-work", `p-work${ADA}`, `p-work${ROOM}`]);
  });
});

const teamAudiences = (threadId: string): Audience => ({ "ada-chat": "member:p_ada", "cleo-chat": "member:p_cleo", "room-chat": "room:launch" } as Record<string, Audience>)[threadId] ?? "team";
const at = (threadId: string) => ({ threadId, generation: "gen-1" });
const AUDIENCES_FILE = join(DATA_DIR, "browser", "audiences.json");
const ADA = audienceBrowserSuffix("member:p_ada"), CLEO = audienceBrowserSuffix("member:p_cleo"), ROOM = audienceBrowserSuffix("room:launch");
function forgetAudiences() { rmSync(AUDIENCES_FILE, { force: true }); }

describe("a Team Cloud's browsers, one per audience", () => {
  afterEach(forgetAudiences);

  it("gives each member's private chat, a group chat and the team's chat a profile of its own", async () => {
    const { host, minted } = setup({ audienceOf: teamAudiences });
    const browsers = await Promise.all(["ada-chat", "cleo-chat", "room-chat", "main-chat"].map((thread) => host.browserIntegration("scout", undefined, at(thread))));
    expect(browsers.map((browser) => browser?.spec.args), "one profile per audience; the team's keeps the bot's own").toEqual([
      [`bot:scout${ADA}`], [`bot:scout${CLEO}`], [`bot:scout${ROOM}`], ["bot:scout"],
    ]);
    expect(browsers.map((browser) => browser?.session)).toEqual([`bot-scout${ADA}`, `bot-scout${CLEO}`, `bot-scout${ROOM}`, "bot-scout"]);
    expect(minted.map((capability) => (capability as { browserSession: string }).browserSession), "each turn's tools reach its own audience's browser").toEqual(browsers.map((browser) => browser?.session));
    // The live view and the agent name the same browser.
    expect(host.currentBrowserSession("scout", undefined, "member:p_ada")).toBe(browsers[0]!.session);
    expect(host.browserSessionsOf("scout", undefined).sort()).toEqual(browsers.map((browser) => browser!.session).sort());
  });

  it("splits a shared profile and a temporary browser by audience too", async () => {
    const { host } = setup({ audienceOf: teamAudiences });
    expect((await host.browserIntegration("scout", "work", at("ada-chat")))?.spec.args).toEqual([`shared:p-work${ADA}`]);
    expect((await host.browserIntegration("scout", "work", at("room-chat")))?.spec.args).toEqual([`shared:p-work${ROOM}`]);
    expect((await host.browserIntegration("scout", "work", at("main-chat")))?.spec.args).toEqual(["shared:p-work"]);
    const ada = await host.browserIntegration("scout", "guest", at("ada-chat"));
    const cleo = await host.browserIntegration("scout", "guest", at("cleo-chat"));
    expect(ada?.session).not.toBe(cleo?.session);
    expect(await host.browserIntegration("scout", "guest", at("ada-chat"))).toMatchObject({ session: ada?.session });
    await host.forgetTemporaryBrowser("scout");
    expect(host.temporaryBrowserSessions.size, "a deleted bot's temporary browsers go for every audience").toBe(0);
  });

  it("names a shared profile's browser session by audience", () => {
    const { host } = setup({ audienceOf: teamAudiences });
    expect(host.currentBrowserSession("scout", "work", "member:p_ada")).toBe(`p-work${ADA}`);
    expect(host.currentBrowserSession("scout", "work", "room:launch")).toBe(`p-work${ROOM}`);
    expect(host.currentBrowserSession("scout", "work", "team")).toBe("p-work");
    expect(host.currentBrowserSession("scout", undefined, "member:p_ada")).toBe(`bot-scout${ADA}`);
  });

  it("names every browser as before off a team, whoever's conversation it is", async () => {
    const { host } = setup();
    const browser = await host.browserIntegration("scout", undefined, at("ada-chat"));
    expect(browser?.spec.args).toEqual(["bot:scout"]);
    expect(browser?.session).toBe("bot-scout");
    expect((await host.browserIntegration("scout", "work", at("ada-chat")))?.spec.args).toEqual(["shared:p-work"]);
    expect(host.browserSessionsOf("scout", undefined)).toEqual(["bot-scout"]);
    expect(existsSync(AUDIENCES_FILE), "nothing is written off a team").toBe(false);
  });

  it("remembers on disk which audiences have a browser", async () => {
    const { host } = setup({ audienceOf: teamAudiences });
    await host.browserIntegration("scout", undefined, at("ada-chat"));
    expect(JSON.parse(readFileSync(AUDIENCES_FILE, "utf8"))).toEqual({ suffixes: [ADA] });
  });
});

describe("the files a turn uploads", () => {
  it.each([null, "report.txt", "Report.txt"])("gives Chrome on Windows a private copy of a workspace file (name: %s)", async (name) => {
    const work = realpathSync(mkdtempSync(join(tmpdir(), "omb-host-upload-windows-")));
    try {
      const file = join(work, "report.txt");
      writeFileSync(file, "report");
      const { host } = setup();
      vi.stubGlobal("process", { ...process, platform: "win32" });
      const [staged] = await host.uploadPaths([{ file, name }]);
      vi.unstubAllGlobals();
      expect(staged!.startsWith(join(DATA_DIR, "browser-uploads"))).toBe(true);
      expect(readFileSync(staged!, "utf8")).toBe("report");
    } finally {
      vi.unstubAllGlobals();
      rmSync(work, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("keeps workspace bytes through a symlink swap while Chrome waits for a picker", async () => {
    const work = realpathSync(mkdtempSync(join(tmpdir(), "omb-host-upload-")));
    try {
      const secret = join(work, "secret.txt");
      const workspace = join(work, "workspace");
      mkdirSync(workspace);
      const source = join(workspace, "report.txt");
      writeFileSync(source, "report");
      writeFileSync(secret, "outside secret");
      const checked = uploadableFiles([source], [workspace]);
      if ("error" in checked) throw new Error(checked.error);
      const { host } = setup({ cloudHome: true });
      const paths = await host.uploadPaths(checked.files.map((file) => ({ file, name: null })));
      const choosers = new FileChoosers();
      let opened!: (params: Params) => void;
      const uploaded: Array<{ method: string; files: unknown; bytes: string[] }> = [];
      const session = {
        on: (_method: string, listener: (params: Params) => void) => { opened = listener; return () => {}; },
        send: async (method: string, params: Params) => { uploaded.push({ method, files: params.files, bytes: (params.files as string[]).map((path) => readFileSync(path, "utf8")) }); return {}; },
      } as unknown as CdpSession;
      choosers.watch(session);
      const answering = choosers.answer(paths);
      rmSync(source);
      symlinkSync(secret, source);
      opened({ frameId: "F", backendNodeId: 7, mode: "selectSingle" });
      await answering;
      expect(uploaded).toEqual([{ method: "DOM.setFileInputFiles", files: [expect.stringMatching(/browser-uploads/)], bytes: ["report"] }]);
      expect(paths[0]).not.toBe(source);
      expect(readFileSync(paths[0]!, "utf8")).toBe("report");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
