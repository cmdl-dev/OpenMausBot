import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CHROME_PACKAGES, installChromeLibraries, packagesToInstall } from "./libraries.ts";

const NOT_CHROME = new Set(["ca-certificates", "curl", "git"]);

/** The packages the Docker image's runtime stage installs with apt, before its user is made. */
function dockerfilePackages(): string[] {
  const dockerfile = readFileSync(new URL("../../../Dockerfile", import.meta.url), "utf8");
  const runtime = dockerfile.slice(dockerfile.indexOf("AS runtime"));
  const install = runtime.slice(runtime.indexOf("apt-get install"), runtime.indexOf("&& rm -rf /var/lib/apt/lists/*"));
  return install.replace(/\\\n/gu, " ").split(/\s+/u).filter((word) => /^[a-z0-9][a-z0-9.+-]+$/u.test(word) && !["apt-get", "install"].includes(word) && !NOT_CHROME.has(word));
}

describe("Chrome's system libraries", () => {
  it("installs every library the Docker image does", () => {
    const listed = dockerfilePackages();
    expect(listed.length).toBeGreaterThan(30);
    for (const name of listed) expect(CHROME_PACKAGES.some((alternatives) => alternatives.includes(name)), name).toBe(true);
  });

  it("takes the t64 name where the host offers it, and the older name elsewhere", async () => {
    const renamed = new Set(CHROME_PACKAGES.filter((alternatives) => alternatives.length > 1).map((alternatives) => alternatives.at(-1)));
    const ubuntu = await packagesToInstall(async (name) => !renamed.has(name));
    expect(ubuntu).toContain("libasound2t64");
    expect(ubuntu).not.toContain("libasound2");
    const bookworm = await packagesToInstall(async (name) => !name.endsWith("t64"));
    expect(bookworm).toContain("libasound2");
    expect(bookworm).toContain("libnss3");
  });

  it("runs apt as root on Linux only, and stops when apt fails", async () => {
    const calls: string[][] = [];
    const run = async (command: string, args: readonly string[]) => { calls.push([command, ...args]); return 0; };
    await installChromeLibraries({ log: () => {}, platform: "linux", uid: 0, offered: async () => true, run });
    expect(calls[0]).toEqual(["apt-get", "update"]);
    expect(calls[1]!.slice(0, 4)).toEqual(["apt-get", "install", "-y", "--no-install-recommends"]);
    await expect(installChromeLibraries({ log: () => {}, platform: "linux", uid: 1000, run })).rejects.toThrow("needs root");
    await expect(installChromeLibraries({ log: () => {}, platform: "darwin", uid: 0, run })).rejects.toThrow("Linux only");
    await expect(installChromeLibraries({ log: () => {}, platform: "linux", uid: 0, offered: async () => true, run: async () => 100 })).rejects.toThrow("apt-get update failed");
  });
});
