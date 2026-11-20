// Ported from T3 Code's apps/server/src/preview/PreviewBrowserHost.ts,
// Copyright 2026 T3 Tools Inc., used under the MIT License
// (third_party/t3-code/LICENSE). Modified: plain TypeScript instead of Effect,
// OMB's command and environment names, and an AppArmor profile pinned to one
// exact executable instead of a wildcard path.
//
// OMB turns Chrome's sandbox off by itself only in a container or when it runs
// as root (needsNoSandbox), where a sandboxed Chrome cannot start and the
// container is the isolation boundary. Anywhere else a host that cannot give
// Chrome its sandbox gets setup steps instead (the service's root step, or by
// hand), and only an operator's explicit OMB_BROWSER_SANDBOX=0 launches without it.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import { needsNoSandbox } from "./identity.ts";
import { chromeForTestingArchiveFolder, chromeForTestingUrl, SANDBOX_CHROME_ROOT, sandboxChromeExecutable, type ChromeForTestingPin } from "./install.ts";

/** Installs the Linux libraries Chrome needs (as root, once). */
export const LIBRARIES_COMMAND = "sudo openmausbot browser install --with-deps";
/** `openmausbot service install` sets the sandbox up before every start; these are its steps, and the ones by hand. */
export const SANDBOX_STEPS_URL = "https://github.com/milind-soni/OpenMausBot/blob/main/docs/deploy-vps.md#ubuntu-2404-browser-sandbox";

/** What Chrome prints before aborting when it cannot sandbox itself. */
export const NO_SANDBOX_SIGNATURE = "No usable sandbox";
/** Chrome's sandbox refuses root, which most containers run as. */
const ROOT_SIGNATURE = "Running as root without --no-sandbox";
/** A sandbox with no user namespaces to move into, as in a container. */
const NAMESPACE_SIGNATURE = "Failed to move to new namespace";
/** Docker's and Podman's marks inside a container. */
const CONTAINER_MARKERS = ["/.dockerenv", "/run/.containerenv"];

export function sandboxDisabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.OMB_BROWSER_SANDBOX === "0";
}

/** Whether the bots' Chrome runs in its own sandbox: not when an operator turned it off, in a container, or as root. */
export function chromeSandbox(env: NodeJS.ProcessEnv): boolean {
  return !sandboxDisabled(env) && !needsNoSandbox(env);
}

/** Set on Ubuntu 23.10+: unprivileged user namespaces need an AppArmor profile. */
export const USERNS_RESTRICTION = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";
export const APPARMOR_PROFILE_NAME = "openmausbot-chrome";
export const APPARMOR_PROFILE_PATH = `/etc/apparmor.d/${APPARMOR_PROFILE_NAME}`;

/**
 * Lets exactly one root-owned Chrome create the user namespace its sandbox runs
 * in, modelled on the profile Ubuntu ships for Google Chrome. A path a user can
 * write, or a pattern, would let any program claim the exemption.
 */
export function appArmorProfile(executable: string): string {
  if (!isAbsolute(executable) || /[\s*?[\]{}"'\\^]/.test(executable) || !executable.startsWith("/opt/")) {
    throw new Error(`The browser's AppArmor exemption is only for a root-owned path under /opt, not ${executable}.`);
  }
  return `# Written for OpenMausBot: lets its Chrome use its sandbox.
abi <abi/4.0>,
include <tunables/global>

profile ${APPARMOR_PROFILE_NAME} ${executable} flags=(unconfined) {
  userns,

  include if exists <local/${APPARMOR_PROFILE_NAME}>
}
`;
}

/** Where the systemd unit's root step lives: root runs only this root-owned copy, never the service user's writable CLI. */
export const SANDBOX_SCRIPT_PATH = "/usr/local/sbin/openmausbot-browser-sandbox";

/**
 * The root step `openmausbot service install` puts before every start. Where
 * AppArmor restricts user namespaces it installs the pinned Chrome for Testing,
 * checked against its SHA-256, as a root-owned copy, and loads the profile that
 * lets exactly that copy use its sandbox; elsewhere it does nothing.
 */
export function sandboxSetupScript(pin: ChromeForTestingPin): string {
  if (!/^\d+(?:\.\d+)+$/.test(pin.version) || !/^[0-9a-f]{64}$/.test(pin.sha256)) throw new Error(`Chrome for Testing ${pin.version} has no usable pin.`);
  const executable = sandboxChromeExecutable(pin);
  const profile = appArmorProfile(executable);
  return `#!/bin/sh
# Written by \`openmausbot service install\`; openmausbot.service runs it as root
# before each start. Where AppArmor blocks unprivileged user namespaces (Ubuntu
# 23.10+), Chrome's sandbox needs a profile that names one root-owned executable:
# this installs Chrome for Testing ${pin.version} at ${executable} and lets only
# that copy use its sandbox. A failure here never stops the server starting.
set -eu
umask 022
say() { echo "openmausbot-browser-sandbox: $*"; }

restricted=$(cat ${USERNS_RESTRICTION} 2>/dev/null || echo 0)
[ "$restricted" = 1 ] || exit 0
for tool in curl sha256sum unzip apparmor_parser; do
  command -v "$tool" >/dev/null 2>&1 || { say "$tool is missing; install it (sudo openmausbot browser install --with-deps installs unzip)" >&2; exit 1; }
done

root=${SANDBOX_CHROME_ROOT}
dir=$root/chrome-${pin.version}
if [ ! -x "$dir/chrome" ]; then
  say "installing Chrome for Testing ${pin.version} into $dir"
  install -d -o root -g root -m 0755 "$root"
  work=$(mktemp -d "$root/.install.XXXXXX")
  trap 'rm -rf "$work"' EXIT
  curl -fsSL --retry 3 -o "$work/chrome.zip" '${chromeForTestingUrl(pin)}'
  echo "${pin.sha256}  $work/chrome.zip" | sha256sum -c - >/dev/null 2>&1 || { say "the Chrome download failed its SHA-256 check; nothing was installed" >&2; exit 1; }
  unzip -q "$work/chrome.zip" -d "$work/unpacked"
  chown -R root:root "$work/unpacked"
  chmod -R go-w "$work/unpacked"
  rm -rf "$dir"
  mv "$work/unpacked/${chromeForTestingArchiveFolder(pin)}" "$dir"
fi
for old in "$root"/chrome-[0-9]*; do
  [ "$old" = "$dir" ] || rm -rf "$old"
done

cat > ${APPARMOR_PROFILE_PATH}.new <<'PROFILE'
${profile}PROFILE
mv ${APPARMOR_PROFILE_PATH}.new ${APPARMOR_PROFILE_PATH}
apparmor_parser -r ${APPARMOR_PROFILE_PATH}
say "Chrome ${pin.version} may use its sandbox"
`;
}

export type BrowserHostNeed = "sandbox" | "container" | "libraries";

export class BrowserHostError extends Error {
  readonly kind: BrowserHostNeed;
  readonly libraries: readonly string[];

  constructor(kind: BrowserHostNeed, libraries: readonly string[] = []) {
    super(kind === "sandbox"
      ? `This host blocks the sandbox the browser runs in (AppArmor on Ubuntu 23.10+). An administrator can allow it for one root-owned copy of Chrome: run \`openmausbot service install\` and the sudo commands it prints, which set this up before every start, or follow ${SANDBOX_STEPS_URL}. Then try again.`
      : kind === "container"
      ? "Chrome's sandbox can't start in this container. The operator can set OMB_BROWSER_SANDBOX=0 to run the browser without it and rely on the container's isolation, then restart OpenMausBot."
      : `This host is missing libraries the browser needs (${libraries.join(", ")}). Run \`${LIBRARIES_COMMAND}\` on the host to install them, then try again.`);
    this.name = "BrowserHostError";
    this.kind = kind;
    this.libraries = libraries;
  }
}

const MISSING_LIBRARY = /^\s*(\S+) => not found$/gm;
/** glibc's loader abort, naming the first library it could not load. */
const LOADER_ERROR = /error while loading shared libraries: ([^:\s]+)/;

/** The library glibc's loader names in a failed launch's output, if any. */
export function loaderMissingLibrary(output: string): string | undefined {
  return LOADER_ERROR.exec(output)?.[1];
}

function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, [...args], { timeout: 5_000, encoding: "utf8", windowsHide: true, env }, (_error, stdout, stderr) => resolve(`${stdout ?? ""}${stderr ?? ""}`));
  });
}

/**
 * Shared libraries the loader cannot find, with the environment the browser
 * was launched in. The browser's own `--version` decides whether any are
 * missing; `ldd` only lists them after the loader fails, because it can report
 * libraries a host provides another way (NixOS's nix-ld).
 */
export async function missingLibraries(executable: string, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const loaderError = loaderMissingLibrary(await run(executable, ["--version"], env));
  if (loaderError === undefined) return [];
  const listed = [...(await run("ldd", [executable], env)).matchAll(MISSING_LIBRARY)].map((match) => match[1]!);
  return listed.length > 0 ? listed : [loaderError];
}

/** The host setup a failure needs, found behind the errors that carried it, or null. */
export function hostSetupOf(error: unknown): BrowserHostError | null {
  for (let at = error, depth = 0; at instanceof Error && depth < 8; at = at.cause, depth += 1) {
    if (at instanceof BrowserHostError) return at;
  }
  return null;
}

/** After a launch fails, the host setup it is missing, or null when none explains it. */
export async function diagnoseLaunchFailure(input: {
  executable: string;
  output: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}): Promise<BrowserHostError | null> {
  const { output, exists = existsSync } = input;
  const noSandbox = output.includes(NO_SANDBOX_SIGNATURE) || output.includes(NAMESPACE_SIGNATURE);
  if (output.includes(ROOT_SIGNATURE) || (noSandbox && CONTAINER_MARKERS.some(exists))) return new BrowserHostError("container");
  if (noSandbox) return new BrowserHostError("sandbox");
  if ((input.platform ?? process.platform) !== "linux") return null;
  const libraries = await missingLibraries(input.executable, input.env);
  return libraries.length ? new BrowserHostError("libraries", libraries) : null;
}

/** Whether the sandbox will be blocked here: user namespaces are restricted and the profile is not installed. Readable without root. */
export function sandboxBlocked({ platform = process.platform, read = (path: string) => readFileSync(path, "utf8"), exists = existsSync }: {
  platform?: NodeJS.Platform;
  read?: (path: string) => string;
  exists?: (path: string) => boolean;
} = {}): boolean {
  if (platform !== "linux") return false;
  let restricted = false;
  try { restricted = read(USERNS_RESTRICTION).trim() === "1"; } catch {}
  return restricted && !exists(APPARMOR_PROFILE_PATH);
}
