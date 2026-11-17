// `openmausbot browser install --with-deps`: the Debian and Ubuntu packages Chrome needs on a server, installed with apt.
// The list is the Docker image's (Dockerfile, runtime stage), plus unzip for the Chrome for Testing download. Ubuntu 24.04 and Debian 13 renamed some with a `t64` suffix,
// so each entry lists the new name first and apt installs whichever the host offers.
import { execFile, spawn } from "node:child_process";

export const CHROME_PACKAGES: ReadonlyArray<ReadonlyArray<string>> = [
  ["libxcb-shm0"], ["libx11-xcb1"], ["libx11-6"], ["libxcb1"], ["libxext6"], ["libxrandr2"], ["libxcomposite1"],
  ["libxcursor1"], ["libxdamage1"], ["libxfixes3"], ["libxi6"], ["libgtk-3-0t64", "libgtk-3-0"],
  ["libpangocairo-1.0-0"], ["libpango-1.0-0"], ["libatk1.0-0t64", "libatk1.0-0"], ["libcairo-gobject2"], ["libcairo2"],
  ["libgdk-pixbuf-2.0-0"], ["libxrender1"], ["libasound2t64", "libasound2"], ["libfreetype6"], ["libfontconfig1"],
  ["libdbus-1-3"], ["libnss3"], ["libnss3-tools"], ["libnspr4"], ["libatk-bridge2.0-0t64", "libatk-bridge2.0-0"],
  ["libdrm2"], ["libxkbcommon0"], ["libatspi2.0-0t64", "libatspi2.0-0"], ["libcups2t64", "libcups2"], ["libxshmfence1"],
  ["libgbm1"], ["fonts-noto-color-emoji"], ["fonts-noto-cjk"], ["fonts-freefont-ttf"],
  // Not a library: Chrome for Testing downloads as a zip.
  ["unzip"],
];

export type Offered = (name: string) => Promise<boolean>;
export type Run = (command: string, args: readonly string[]) => Promise<number>;

/** apt-cache answers 0 for a package the host's sources offer with a candidate version. */
const offeredByApt: Offered = (name) => new Promise((resolve) => {
  execFile("apt-cache", ["policy", name], { encoding: "utf8", timeout: 30_000 }, (error, stdout) => {
    resolve(!error && /Candidate: (?!\(none\))\S+/u.test(String(stdout)));
  });
});

const runInherited: Run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, [...args], { stdio: "inherit", env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" } });
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});

/** The name of each package this host's apt offers, first alternative first. */
export async function packagesToInstall(offered: Offered): Promise<string[]> {
  const names: string[] = [];
  for (const alternatives of CHROME_PACKAGES) {
    let chosen = alternatives.at(-1)!;
    for (const name of alternatives) {
      if (await offered(name)) { chosen = name; break; }
    }
    names.push(chosen);
  }
  return names;
}

/** As root on Linux with apt: updates the package lists and installs Chrome's libraries. */
export async function installChromeLibraries(options: { log: (line: string) => void; platform?: NodeJS.Platform; uid?: number; offered?: Offered; run?: Run }): Promise<void> {
  if ((options.platform ?? process.platform) !== "linux") throw new Error("Chrome's system libraries are installed this way on Linux only.");
  if ((options.uid ?? process.getuid?.()) !== 0) throw new Error("Installing Chrome's system libraries needs root: run it with sudo.");
  const run = options.run ?? runInherited;
  if (await run("apt-get", ["update"]) !== 0) throw new Error("apt-get update failed; this installer needs a Debian or Ubuntu host with apt.");
  const names = await packagesToInstall(options.offered ?? offeredByApt);
  options.log(`installing ${names.length} packages Chrome needs`);
  if (await run("apt-get", ["install", "-y", "--no-install-recommends", ...names]) !== 0) throw new Error("apt-get install failed; see its output above.");
}
