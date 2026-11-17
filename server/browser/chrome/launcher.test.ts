import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, posix } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { removeTempDir } from "../../testing/cleanup.ts";
import type { ChromeIdentity } from "./identity.ts";
import { chromeForTestingExecutable, chromeForTestingPin, type installChromeForTesting } from "./install.ts";
import { BrowserHostError, hostSetupOf } from "./host-setup.ts";
import { ChromeLaunchError } from "./launch.ts";
import { ChromeLauncher } from "./launcher.ts";
import { chromeHost } from "./resolve.ts";

const folders: string[] = [];
afterAll(async () => { for (const folder of folders) await removeTempDir(folder); });

const identity = (major: string, brand = "Google Chrome"): ChromeIdentity => ({
  userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
  userAgentMetadata: {
    brands: [{ brand, version: major }, { brand: "Chromium", version: major }], fullVersionList: [{ brand, version: `${major}.0.1.2` }, { brand: "Chromium", version: `${major}.0.1.2` }],
    fullVersion: `${major}.0.1.2`, platform: "macOS", platformVersion: "26.3.1", architecture: "arm", model: "", mobile: false, bitness: "64", wow64: false, formFactors: ["Desktop"],
  },
});

/** A Mac whose LaunchServices knows a Google Chrome in a temporary folder, or none. */
function mac(options: { chrome?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const root = mkdtempSync(join(tmpdir(), "omb-launcher-"));
  folders.push(root);
  const app = join(root, "Google Chrome.app");
  const chrome = posix.join(app, "Contents/MacOS/Google Chrome");
  if (options.chrome !== false) {
    mkdirSync(dirname(chrome), { recursive: true });
    writeFileSync(chrome, "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(app, "Contents", "Info.plist"), "<plist>155.0.1.2</plist>");
  }
  const dataDir = join(root, "data");
  const env = { HOME: root, ...options.env };
  // Only this folder exists for the launcher: the machine running the test may have a Google Chrome of its own.
  const inside = (path: string) => path.startsWith(root) || path.startsWith(options.env?.OMB_CHROME_PATH ?? "\0");
  const real = chromeHost({ dataDir, env, platform: "darwin", arch: "arm64" });
  const host = { ...real, exists: (path: string) => inside(path) && existsSync(path), list: (folder: string) => inside(folder) ? real.list(folder) : [], appForBundleId: () => options.chrome === false ? null : app };
  return { root, app, chrome, dataDir, env, host };
}

function launcher(machine: ReturnType<typeof mac>, overrides: Partial<ConstructorParameters<typeof ChromeLauncher>[0]> = {}) {
  return new ChromeLauncher({
    dataDir: machine.dataDir, env: machine.env, platform: "darwin", arch: "arm64", host: machine.host,
    calibrate: vi.fn(async () => identity("155")), log: () => {},
    install: async () => { throw new Error("offline"); },
    ...overrides,
  });
}

describe("the Chrome launcher", () => {
  it("runs the installed Google Chrome, with the identity read from that binary under the person's own home on a Mac", async () => {
    const machine = mac();
    const calibrate = vi.fn(async () => identity("155"));
    const chrome = launcher(machine, { calibrate });
    expect(chrome.describe()).toBe("Google Chrome (installed; not started yet)");
    const binary = await chrome.binary();
    expect(binary).toMatchObject({ path: machine.chrome, source: "installed", identity: identity("155") });
    expect(calibrate).toHaveBeenCalledExactlyOnceWith(machine.chrome, { ...machine.env, HOME: userInfo().homedir });
    expect(machine.env.HOME).not.toBe(userInfo().homedir);
    expect(chrome.describe()).toBe("Google Chrome 155 (installed)");
    await launcher(machine, { calibrate }).binary();
    expect(calibrate).toHaveBeenCalledOnce();
  });

  it("reads the identity again after Chrome updated itself in place", async () => {
    const machine = mac();
    const calibrate = vi.fn(async () => identity("155"));
    const chrome = launcher(machine, { calibrate });
    await chrome.binary();
    calibrate.mockResolvedValue(identity("156"));
    writeFileSync(join(machine.app, "Contents", "Info.plist"), "<plist>156.0.1.2</plist>");
    utimesSync(join(machine.app, "Contents", "Info.plist"), new Date(), new Date(Date.now() + 60_000));
    expect((await chrome.binary()).identity.userAgent).toContain("Chrome/156.0.0.0");
    expect(calibrate).toHaveBeenCalledTimes(2);
    expect(chrome.describe()).toBe("Google Chrome 156 (installed)");
  });

  it("downloads Chrome for Testing where there is no Chrome, and says how far it got while a call waits", async () => {
    const machine = mac({ chrome: false });
    const pin = chromeForTestingPin("darwin", "arm64")!;
    let finish!: () => void;
    const install = vi.fn(async (options: Parameters<typeof installChromeForTesting>[0]) => {
      options.onProgress?.({ received: 52 * 1_048_576, total: pin.bytes });
      await new Promise<void>((resolve) => { finish = resolve; });
      const path = chromeForTestingExecutable(options.dataDir, options.pin);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "#!/bin/sh\n", { mode: 0o755 });
      return path;
    });
    const chrome = launcher(machine, { install, readyWaitMs: 20, calibrate: async () => identity("153", "Not_A Brand") });
    expect(chrome.describe()).toBe("Chrome for Testing 153.0.8010.47 (not downloaded yet)");
    await expect(chrome.binary()).rejects.toThrow("Getting the browser ready (52 of 182 MB). Try again in a minute.");
    expect(chrome.describe()).toBe("Chrome for Testing 153.0.8010.47 (downloading: 52 of 182 MB)");
    finish();
    await chrome.prepare();
    expect(await chrome.binary()).toMatchObject({ source: "downloaded" });
    expect(install).toHaveBeenCalledOnce();
    expect(chrome.describe()).toBe("Chrome for Testing 153 (downloaded)");
  });

  it("uses Chrome for Testing when the installed Google Chrome cannot start headless", async () => {
    const machine = mac();
    const install = vi.fn(async (options: Parameters<typeof installChromeForTesting>[0]) => {
      const path = chromeForTestingExecutable(options.dataDir, options.pin);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "#!/bin/sh\n", { mode: 0o755 });
      return path;
    });
    const calibrate = vi.fn(async (path: string) => {
      if (path === machine.chrome) throw new Error("the browser exited (1) before it answered");
      return identity("153", "Not_A Brand");
    });
    const chrome = launcher(machine, { install, calibrate });
    expect((await chrome.binary()).path).toMatch(/chrome-mac-arm64[\\/]Google Chrome for Testing\.app/u);
    expect(chrome.describe()).toBe("Chrome for Testing 153 (downloaded)");
  });

  it("says why when Chrome cannot be prepared at all", async () => {
    const named = mkdtempSync(join(tmpdir(), "omb-named-"));
    folders.push(named);
    writeFileSync(join(named, "chrome"), "#!/bin/sh\n", { mode: 0o755 });
    const chrome = launcher(mac({ env: { OMB_CHROME_PATH: join(named, "chrome") } }), {
      calibrate: async () => { throw new Error("the browser's user agent is not Chrome's"); },
    });
    await expect(chrome.binary()).rejects.toThrow("Chrome could not be started (the browser's user agent is not Chrome's).");
    expect(chrome.describe()).toBe("Chrome could not be started: the browser's user agent is not Chrome's");
    expect(chrome.hostProblem(), "not something the host must change").toBeNull();
  });

  it("keeps what the host needs behind the error a viewer gets, when Chrome cannot start there", async () => {
    const named = mkdtempSync(join(tmpdir(), "omb-named-"));
    folders.push(named);
    writeFileSync(join(named, "chrome"), "#!/bin/sh\n", { mode: 0o755 });
    const host = new BrowserHostError("sandbox");
    const chrome = launcher(mac({ env: { OMB_CHROME_PATH: join(named, "chrome") } }), {
      calibrate: async () => { throw new ChromeLaunchError(host.message, "No usable sandbox!", host); },
    });
    const failure = await chrome.binary().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("AppArmor");
    expect(hostSetupOf(failure)).toBe(host);
    expect(chrome.hostProblem()).toBe(host.message);
  });

  it("keeps a working Chrome when reading a newer binary fails, rather than switch browsers mid-session", async () => {
    const machine = mac();
    const calibrate = vi.fn(async () => identity("155"));
    const chrome = launcher(machine, { calibrate });
    await chrome.binary();
    calibrate.mockRejectedValue(new Error("Chrome crashed"));
    utimesSync(join(machine.app, "Contents", "Info.plist"), new Date(), new Date(Date.now() + 120_000));
    expect((await chrome.binary()).path).toBe(machine.chrome);
    expect(chrome.describe()).toBe("Google Chrome 155 (installed)");
    await chrome.binary();
    expect(calibrate).toHaveBeenCalledTimes(2);
  });

  it("has no browser, and says installing Google Chrome fixes it, where there is no Chrome and none is pinned", async () => {
    const machine = mac({ chrome: false });
    const calibrate = vi.fn();
    const chrome = launcher(machine, { calibrate, arch: "x64", host: { ...machine.host, arch: "x64" } });
    expect(chrome.plan().kind).toBe("none");
    expect(chrome.describe()).toBe("no Chrome (Google Chrome is not installed. Install Google Chrome to give your bots a browser, then restart OpenMausBot.)");
    await chrome.prepare();
    await expect(chrome.binary()).rejects.toThrow("There is no Chrome for the bots' browser here: Google Chrome is not installed. Install Google Chrome");
    expect(calibrate).not.toHaveBeenCalled();
  });
});
