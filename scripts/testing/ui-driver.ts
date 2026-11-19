// The browser `control-omb ui` drives the app's own renderer with in tests and verification: Vercel's agent-browser CLI,
// pinned and checked by size and SHA-256. A developer tool only: the bots' browser never uses it, and no package ships it.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const VERSION = "0.37.0";
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

interface Asset { asset: string; sha256: string; bytes: number }

// Digests of the official GitHub assets, computed on 2026-09-08.
const RELEASES: Record<string, Asset> = {
  "darwin-arm64": { asset: "agent-browser-darwin-arm64", sha256: "da5a2b4ef7be8ba279b1258c542c33877f480b1951d0d94de607fc1528edd380", bytes: 12429360 },
  "darwin-x64": { asset: "agent-browser-darwin-x64", sha256: "f402c96350ffd2adc68d0e5e4d83aa49cf7735fef29882a8866be36cc2fc67e9", bytes: 13588296 },
  "linux-arm64": { asset: "agent-browser-linux-arm64", sha256: "0315a8c4f7bf167cc5fd5eeaea79009b0e6b5d2ae8b3057bf6f96be978483426", bytes: 12507840 },
  "linux-x64": { asset: "agent-browser-linux-x64", sha256: "78e0c5a14a7fa1f3d1ae2acdbdcc94a047b435b998a8c505fcc49d7fa4935a49", bytes: 14253776 },
};

const executable = (platform: NodeJS.Platform) => (platform === "win32" ? "agent-browser.exe" : "agent-browser");

function pinnedPath(toolsDir: string, platform: NodeJS.Platform): string {
  return join(toolsDir, "tools", "agent-browser", VERSION, executable(platform));
}

/** OMB_AGENT_BROWSER_PATH, then the pinned copy under the tools directory, then PATH. */
export function resolveUiDriver(toolsDir: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const named = env.OMB_AGENT_BROWSER_PATH?.trim();
  if (named) return existsSync(resolve(named)) ? resolve(named) : null;
  const pinned = pinnedPath(toolsDir, platform);
  if (existsSync(pinned)) return pinned;
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    const candidate = dir.trim() && resolve(dir.trim(), executable(platform));
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Downloads the pinned build; the file gets its final name only once its size and digest match. */
export async function installUiDriver(toolsDir: string, log: (line: string) => void = () => {}, platform: NodeJS.Platform = process.platform, arch: string = process.arch): Promise<string> {
  const asset = RELEASES[`${platform}-${arch}`];
  if (!asset) throw new Error(`no pinned agent-browser for ${platform}-${arch}; set OMB_AGENT_BROWSER_PATH`);
  const destination = pinnedPath(toolsDir, platform);
  mkdirSync(join(destination, ".."), { recursive: true, mode: 0o700 });
  log(`downloading agent-browser ${VERSION} for the UI harness (${Math.round(asset.bytes / 1024 / 1024)} MB, digest pinned)`);
  const response = await fetch(`https://github.com/vercel-labs/agent-browser/releases/download/v${VERSION}/${asset.asset}`, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`the agent-browser download failed (HTTP ${response.status})`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length !== asset.bytes || createHash("sha256").update(body).digest("hex") !== asset.sha256) {
    throw new Error("the agent-browser download did not match its pinned size and SHA-256; nothing was installed");
  }
  const staging = `${destination}.${randomBytes(6).toString("hex")}.part`;
  writeFileSync(staging, body, { mode: 0o755 });
  if (platform !== "win32") chmodSync(staging, 0o755);
  renameSync(staging, destination);
  return destination;
}

function run(binary: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<number | null> {
  return new Promise((done) => {
    const child = spawn(binary, args, { env, stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => { child.kill("SIGKILL"); done(null); }, timeoutMs);
    timer.unref?.();
    child.once("error", () => { clearTimeout(timer); done(null); });
    child.once("exit", (code) => { clearTimeout(timer); done(code); });
  });
}

/** `agent-browser install`: Chrome for Testing under the env's HOME, when no Chrome is named. */
export async function installUiDriverChrome(binary: string, env: NodeJS.ProcessEnv): Promise<void> {
  const code = await run(binary, ["install"], env, DOWNLOAD_TIMEOUT_MS);
  if (code !== 0) throw new Error(`agent-browser install ${code === null ? "timed out" : `exited ${code}`}`);
}

/** Closes the session's browser; true once the CLI said it did. */
export async function closeUiDriverSession(binary: string, env: NodeJS.ProcessEnv, timeoutMs = 15_000): Promise<boolean> {
  return await run(binary, ["close"], env, timeoutMs) === 0;
}
