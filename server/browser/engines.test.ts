import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ListenerOwnership } from "./egress/ownership.ts";
import type { EgressHost } from "./egress/policy.ts";
import { REDDIT_REFUSAL } from "./egress/reddit.ts";
import { BrowserEgress, OwnListeners } from "./egress/registry.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { CHROME_ENGINE, BrowserLive, BrowserRuntime, ChromeEngine, chromeTarget, profileKey, type BrowserRuntimeOptions } from "./engines.ts";

const CHROME = { command: CHROME_ENGINE, args: ["bot:a"], env: {} };
const NOT_STARTED = { command: "/opt/agent-browser", args: ["--session", "s"], env: {} };

function engines(options: BrowserRuntimeOptions = {}) {
  const chrome = {
    service: {
      agentRpc: vi.fn(async (_target: unknown, _method: string, _params: unknown, beforeDispatch?: () => void) => { beforeDispatch?.(); return "chrome"; }),
      previewFrame: vi.fn(async () => ({ png: "frame", format: "jpeg" })),
      withSecretInput: vi.fn(async (_target: unknown, fn: () => Promise<unknown>) => fn()),
      heldBy: vi.fn((): string | null => null),
      interrupted: vi.fn(() => true),
      interruptedCount: vi.fn(() => 2),
      close: vi.fn(async () => undefined),
      fileChooserOffered: vi.fn(() => true),
      answerFileChooser: vi.fn(async () => true),
      download: vi.fn(() => ({ id: "d1" })),
    },
    live: { open: vi.fn(async () => undefined), action: vi.fn(async () => "chrome"), handBack: vi.fn(), closeForSession: vi.fn(), closeForOwner: vi.fn(), closeForBot: vi.fn(), closeAll: vi.fn() },
    stream: { open: vi.fn(), closeForSession: vi.fn(), closeForOwner: vi.fn(), closeForBot: vi.fn(), closeAll: vi.fn(), recheck: vi.fn() },
    close: vi.fn(async () => undefined),
  };
  const runtime = new BrowserRuntime(chrome as unknown as ChromeEngine, options);
  const live = new BrowserLive(chrome as unknown as ChromeEngine);
  return { chrome, runtime, live };
}

describe("a browser session's profile", () => {
  it("is named only by a spec of the engine's command with a profile key", () => {
    expect(chromeTarget("s", CHROME)).toEqual({ session: "s", key: "bot:a" });
    expect(chromeTarget("s", NOT_STARTED)).toBeNull();
    expect(chromeTarget("s", { command: CHROME_ENGINE, args: [] })).toBeNull();
    expect(chromeTarget("s", undefined)).toBeNull();
  });

  it("gives a bot its own profile, a shared profile's bots one profile, and a temporary browser its session's", () => {
    expect(profileKey("a", "omb-a", { guest: false, partitionId: null })).toBe("bot:a");
    expect(profileKey("a", "omb-p", { guest: false, partitionId: "p1" })).toBe("shared:p1");
    expect(profileKey("a", "omb-a-guest-1", { guest: true, partitionId: null })).toBe("temp:omb-a-guest-1");
  });
});

describe("the browser runtime", () => {
  it("sends a session's calls to the browser service, and answers a spec that names no profile without it", async () => {
    const { chrome, runtime } = engines();
    await expect(runtime.agentRpc("s", CHROME, "tools/call", { name: "agent_browser_open" })).resolves.toBe("chrome");
    expect(chrome.service.agentRpc).toHaveBeenCalledWith({ session: "s", key: "bot:a" }, "tools/call", { name: "agent_browser_open" }, undefined);
    await expect(runtime.agentRpc("s", NOT_STARTED, "tools/call", { name: "agent_browser_open" })).resolves.toMatchObject({ isError: true });
    expect(chrome.service.agentRpc).toHaveBeenCalledOnce();
  });

  it("takes a preview frame from the service", async () => {
    const { chrome, runtime } = engines();
    await expect(runtime.previewFrame("s")).resolves.toEqual({ png: "frame", format: "jpeg" });
    expect(chrome.service.previewFrame).toHaveBeenCalledWith("s");
  });

  /** As server/host/browser.ts wires it. */
  const onHost = (host: EgressHost) => {
    const egress = new BrowserEgress();
    egress.configure({ host, config: () => ({}), ownership: { botOwned: async () => false } as unknown as ListenerOwnership, listeners: new OwnListeners(host, { env: {} }) });
    return engines({ refusal: (params) => egress.callRefusal(params) });
  };
  const OPENS_REDDIT = [
    { name: "agent_browser_open", arguments: { url: "https://www.reddit.com/r/test/" } },
    { name: "agent_browser_navigate", arguments: { url: "old.reddit.com/r/test" } },
    { name: "agent_browser_tabs", arguments: { action: "new", url: "https://i.redd.it/a.png" } },
    { name: "agent_browser_tab_new", arguments: { url: "https://www.reddit.com/" } },
  ];

  it("tells a bot on MausBot Cloud why its browser doesn't open Reddit, without reaching it", async () => {
    const { chrome, runtime } = onHost("cloud");
    for (const call of OPENS_REDDIT) {
      await expect(runtime.agentRpc("s", CHROME, "tools/call", call), call.name).resolves.toEqual({ isError: true, content: [{ type: "text", text: REDDIT_REFUSAL }] });
    }
    expect(chrome.service.agentRpc).not.toHaveBeenCalled();
    await expect(runtime.agentRpc("s", CHROME, "tools/call", { name: "agent_browser_open", arguments: { url: "https://example.com/" } })).resolves.toBe("chrome");
    await expect(runtime.agentRpc("s", CHROME, "tools/list", OPENS_REDDIT[0])).resolves.toBe("chrome");
  });

  it("opens Reddit on the desktop and on a self-hosted server", async () => {
    for (const host of ["desktop", "server"] as const) {
      const { chrome, runtime } = onHost(host);
      for (const call of OPENS_REDDIT) await expect(runtime.agentRpc("s", CHROME, "tools/call", call)).resolves.toBe("chrome");
      expect(chrome.service.agentRpc).toHaveBeenCalledTimes(OPENS_REDDIT.length);
    }
  });

  it("annotates a call's answer, but not a listing's", async () => {
    const { runtime } = engines({ annotate: (result) => ({ annotated: result }) });
    await expect(runtime.agentRpc("s", CHROME, "tools/call", { name: "agent_browser_snapshot" })).resolves.toEqual({ annotated: "chrome" });
    await expect(runtime.agentRpc("s", CHROME, "tools/list", {})).resolves.toBe("chrome");
  });

  it("answers who holds a session and what was interrupted", () => {
    const { chrome, runtime } = engines();
    expect(runtime.heldBy("s")).toBeNull();
    chrome.service.heldBy.mockReturnValue("viewer-1");
    expect(runtime.heldBy("s")).toBe("viewer-1");
    expect(runtime.interrupted("s")).toBe(true);
    expect(runtime.interruptedCount()).toBe(2);
  });
});

describe("the live views", () => {
  it("opens a session's viewer on the v1 adapter, without the spec", async () => {
    const { chrome, live } = engines();
    const res = {} as never;
    const isCurrent = () => true;
    await live.open({ botId: "a", session: "s", spec: CHROME, owner: "o", isCurrent, res });
    expect(chrome.live.open).toHaveBeenCalledWith({ botId: "a", session: "s", owner: "o", isCurrent, res });
  });

  it("closes viewers, streams included, and streams no longer allowed", () => {
    const { chrome, live } = engines();
    live.closeForSession("s");
    live.closeForOwner("o");
    live.closeAll();
    live.recheck();
    expect(chrome.stream.recheck).toHaveBeenCalledOnce();
    expect(chrome.live.closeForSession).toHaveBeenCalledWith("s");
    expect(chrome.stream.closeForSession).toHaveBeenCalledWith("s");
    expect(chrome.stream.closeForOwner).toHaveBeenCalledWith("o");
    expect(chrome.live.closeAll).toHaveBeenCalledOnce();
    expect(chrome.stream.closeAll).toHaveBeenCalledOnce();
  });

  it("streams a session that names a profile, and takes its uploads and serves its downloads", async () => {
    const { chrome, live } = engines();
    const request = { botId: "a", owner: "o", canOperate: true, params: new URLSearchParams(), req: {} as never, socket: {} as never, head: Buffer.alloc(0), isCurrent: () => true, restartRefusal: () => null };
    expect(live.stream({ session: "s", spec: NOT_STARTED, ...request })).toBe(false);
    expect(chrome.stream.open).not.toHaveBeenCalled();
    expect(live.stream({ session: "s", spec: CHROME, ...request })).toBe(true);
    expect(chrome.stream.open).toHaveBeenCalledWith({ ...request, target: { session: "s", key: "bot:a" } });
    expect(live.fileChooserOffered({ session: "s", spec: CHROME }, "o", "c")).toBe(true);
    expect(chrome.service.fileChooserOffered).toHaveBeenCalledWith("s", "o", "c");
    await expect(live.answerFileChooser({ session: "s", spec: CHROME }, "o", "c", ["/f"])).resolves.toBe(true);
    expect(chrome.service.answerFileChooser).toHaveBeenCalledWith("s", "o", "c", ["/f"]);
    expect(live.download({ session: "s", spec: CHROME }, "d1")).toEqual({ id: "d1" });
  });
});

describe("the engine's summary", () => {
  it("reports the browser unavailable, with the launcher's diagnosis, once Chrome could not start on this host", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "omb-chrome-summary-"));
    const value = new ChromeEngine({ dataDir, host: "server", env: { OMB_CHROME_PATH: process.execPath }, platform: "linux", egressPort: async () => 0, idleMs: () => 180_000, egressNotice: () => null });
    expect(value.summary()).toMatchObject({ kind: "engine" });
    vi.spyOn(value.launcher, "hostProblem").mockReturnValue("This host blocks the sandbox the browser runs in (AppArmor on Ubuntu 23.10+).");
    expect(value.summary()).toEqual({ kind: "unavailable", reason: "Chrome could not be started: This host blocks the sandbox the browser runs in (AppArmor on Ubuntu 23.10+)." });
    void removeTempDir(dataDir);
  });
});

describe("the engine's minute", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("closes idle browsers at start and every minute after", async () => {
    vi.useFakeTimers();
    const dataDir = mkdtempSync(join(tmpdir(), "omb-chrome-engine-"));
    const value = new ChromeEngine({ dataDir, host: "container", env: {}, platform: "linux", egressPort: async () => 0, idleMs: () => 180_000, egressNotice: () => null });
    cleanups.push(async () => { await value.close(); await removeTempDir(dataDir); });
    const closeIdle = vi.spyOn(value.service, "closeIdle").mockResolvedValue([]);
    value.start({ prepare: false });
    expect(closeIdle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(closeIdle).toHaveBeenCalledTimes(3);
    value.start({ prepare: false });
    expect(closeIdle, "a second start keeps the one timer").toHaveBeenCalledTimes(3);
  });
});
