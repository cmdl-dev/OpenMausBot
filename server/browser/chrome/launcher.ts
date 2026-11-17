// The Chrome the bots' browser runs, prepared once per binary: found or downloaded, and its identity read. Once a
// machine's choice is made it is not switched while the server runs.
import { existsSync } from "node:fs";
import { userInfo } from "node:os";

import { calibrateIdentity, chromeFingerprint, loadOrCalibrateIdentity, type CalibratedIdentity } from "./calibrate.ts";
import { hostSetupOf } from "./host-setup.ts";
import { needsNoSandbox, type ChromeIdentity } from "./identity.ts";
import { installChromeForTesting, type ChromeForTestingPin, type DownloadProgress } from "./install.ts";
import { chromeHost, resolveChromePlan, type ChromeHost, type ChromePlan, type FoundChrome } from "./resolve.ts";

type Ready = { kind: "ready"; chrome: FoundChrome; identity: ChromeIdentity; product: string; fingerprint: string };
type State =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "downloading"; pin: ChromeForTestingPin; progress: DownloadProgress }
  | Ready
  | { kind: "failed"; reason: string; cause: unknown };

const SOURCES: Record<FoundChrome["source"], string> = {
  installed: "installed",
  downloaded: "downloaded",
  named: "named by OMB_CHROME_PATH",
};

const megabytes = (bytes: number) => Math.round(bytes / 1_048_576);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export { chromeFingerprint };

export interface ChromeLauncherOptions {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  host?: ChromeHost;
  calibrate?: (executable: string, env: NodeJS.ProcessEnv) => Promise<ChromeIdentity>;
  install?: typeof installChromeForTesting;
  readyWaitMs?: number;
  log?: (line: string) => void;
  /** Chrome's sandbox while its identity is read; by default off in a container and as root (needsNoSandbox). */
  sandbox?: boolean;
}

export class ChromeLauncher {
  private state: State = { kind: "idle" };
  private preparing: Promise<void> | null = null;
  private readonly options: Required<Pick<ChromeLauncherOptions, "dataDir" | "env" | "platform" | "readyWaitMs">> & ChromeLauncherOptions;
  private readonly host: ChromeHost;

  constructor(options: ChromeLauncherOptions) {
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    this.options = { ...options, env, platform, readyWaitMs: options.readyWaitMs ?? 45_000 };
    this.host = options.host ?? chromeHost({ dataDir: options.dataDir, env, platform, arch: options.arch });
  }

  plan(): ChromePlan {
    return resolveChromePlan(this.host);
  }

  prepare(): Promise<void> {
    if (this.preparing) return this.preparing;
    if (this.state.kind === "failed" || (this.state.kind === "ready" && this.fresh(this.state))) return Promise.resolve();
    const plan = this.plan();
    if (plan.kind === "none") return Promise.resolve();
    const previous = this.state.kind === "ready" ? this.state : null;
    if (!previous) this.state = { kind: "preparing" };
    this.preparing = this.prepareFor(plan).then((ready) => {
      this.state = ready;
      this.log(`browser: ${this.describe()}`);
    }, (error: unknown) => {
      // A Chrome that already works is kept as it is: switching browsers under a running session would lose its pages.
      this.state = previous ? { ...previous, fingerprint: this.fingerprintOr(previous) } : { kind: "failed", reason: message(error), cause: error };
      this.log(`browser: Chrome could not be prepared (${message(error)})${previous ? "; keeping the browser already set up" : ""}`);
    }).finally(() => { this.preparing = null; });
    return this.preparing;
  }

  /** What this host must change before Chrome can start (its sandbox, its libraries), once a start showed it; null otherwise. */
  hostProblem(): string | null {
    return this.state.kind === "failed" ? hostSetupOf(this.state.cause)?.message ?? null : null;
  }

  /** For the browser status, e.g. "Google Chrome 153 (installed)". */
  describe(): string {
    const state = this.state;
    if (state.kind === "ready") return `${product(state.chrome, state.identity)} ${state.identity.userAgentMetadata.fullVersion.split(".")[0]} (${SOURCES[state.chrome.source]})`;
    const plan = this.plan();
    if (plan.kind === "none") return `no Chrome (${plan.reason})`;
    if (state.kind === "failed") return `Chrome could not be started: ${state.reason}`;
    if (state.kind === "downloading") return `Chrome for Testing ${state.pin.version} (downloading: ${megabytes(state.progress.received)} of ${megabytes(state.progress.total)} MB)`;
    if (plan.kind === "download") return `Chrome for Testing ${plan.pin.version} (not downloaded yet)`;
    return `${product(plan.chrome)} (${SOURCES[plan.chrome.source]}; not started yet)`;
  }

  /** On macOS every Chrome this starts gets the person's own home, whatever HOME the server runs with (a test fixture's is
   * temporary): elsewhere a "keychain cannot be found" dialog would appear on their screen. */
  private chromeEnv(): NodeJS.ProcessEnv {
    return this.options.platform === "darwin" ? { ...this.options.env, HOME: userInfo().homedir } : this.options.env;
  }

  private fresh(state: Ready): boolean {
    try { return chromeFingerprint(state.chrome.path) === state.fingerprint; } catch { return false; }
  }

  private fingerprintOr(state: Ready): string {
    try { return chromeFingerprint(state.chrome.path); } catch { return state.fingerprint; }
  }

  private async prepareFor(plan: Exclude<ChromePlan, { kind: "none" }>): Promise<Ready> {
    let chrome = plan.kind === "download" ? await this.download(plan.pin) : plan.chrome;
    let identity: CalibratedIdentity;
    try {
      identity = await this.identityOf(chrome);
    } catch (error) {
      if (plan.kind !== "chrome" || plan.chrome.source !== "installed" || !plan.fallback) throw error;
      this.log(`browser: Google Chrome at ${chrome.path} could not start headless (${message(error)}); using Chrome for Testing`);
      chrome = await this.download(plan.fallback);
      identity = await this.identityOf(chrome);
    }
    return { kind: "ready", chrome, identity: { userAgent: identity.userAgent, userAgentMetadata: identity.userAgentMetadata }, product: identity.product, fingerprint: chromeFingerprint(chrome.path) };
  }

  private async download(pin: ChromeForTestingPin): Promise<FoundChrome> {
    this.state = { kind: "downloading", pin, progress: { received: 0, total: pin.bytes } };
    const path = await (this.options.install ?? installChromeForTesting)({
      dataDir: this.options.dataDir, pin,
      onProgress: (progress) => { if (this.state.kind === "downloading") this.state = { ...this.state, progress }; },
    });
    return { path, source: "downloaded" };
  }

  /** Read once per binary version and kept, since starting a browser to read it takes about a second. */
  private async identityOf(chrome: FoundChrome): Promise<CalibratedIdentity> {
    const env = this.chromeEnv();
    const injected = this.options.calibrate;
    const calibrate = injected
      ? async (options: { executablePath: string }): Promise<CalibratedIdentity> => {
        const read = await injected(options.executablePath, env);
        return { ...read, product: `Chrome/${read.userAgentMetadata.fullVersion}`, fingerprint: chromeFingerprint(options.executablePath), calibratedAt: new Date().toISOString() };
      }
      : calibrateIdentity;
    const host = this.options.platform === "linux" && existsSync("/.dockerenv") ? "container" : "desktop";
    const options = { executablePath: chrome.path, host, env, sandbox: this.options.sandbox ?? !needsNoSandbox(env) } as const;
    return (await loadOrCalibrateIdentity(this.options.dataDir, options, calibrate)).identity;
  }

  /** The Chrome and its identity: found or downloaded once, and read once per version. */
  async binary(): Promise<{ path: string; identity: ChromeIdentity; product: string; source: FoundChrome["source"] }> {
    const plan = this.plan();
    if (plan.kind === "none") throw new Error(`There is no Chrome for the bots' browser here: ${plan.reason}`);
    let timer: NodeJS.Timeout | undefined;
    const done = await Promise.race([
      this.prepare().then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), this.options.readyWaitMs); timer.unref?.(); }),
    ]);
    clearTimeout(timer);
    const state = this.state;
    if (!done) {
      throw new Error(state.kind === "downloading"
        ? `Getting the browser ready (${megabytes(state.progress.received)} of ${megabytes(state.progress.total)} MB). Try again in a minute.`
        : "Getting the browser ready. Try again in a moment.");
    }
    if (state.kind === "failed") throw new Error(`Chrome could not be started (${state.reason}).`, { cause: state.cause });
    if (state.kind !== "ready") throw new Error("Chrome is not ready yet. Try again in a moment.");
    return { path: state.chrome.path, identity: state.identity, product: state.product, source: state.chrome.source };
  }

  private log(line: string): void {
    (this.options.log ?? console.log)(line);
  }
}

function product(chrome: FoundChrome, identity?: ChromeIdentity): string {
  if (identity?.userAgentMetadata.brands.some(({ brand }) => brand === "Google Chrome")) return "Google Chrome";
  if (chrome.source === "installed") return "Google Chrome";
  return chrome.source === "downloaded" || /for Testing|chrome-(?:linux|mac|win)/iu.test(chrome.path) ? "Chrome for Testing" : "Chromium";
}
