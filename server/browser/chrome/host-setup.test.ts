import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { removeTempDir } from "../../testing/cleanup.ts";
import {
  APPARMOR_PROFILE_PATH, appArmorProfile, BrowserHostError, diagnoseLaunchFailure, hostSetupOf, LIBRARIES_COMMAND, missingLibraries, SANDBOX_STEPS_URL, sandboxBlocked,
  sandboxDisabled, sandboxSetupScript, USERNS_RESTRICTION,
} from "./host-setup.ts";
import { chromeForTestingPin, SANDBOX_CHROME_ROOT, sandboxChromeExecutable } from "./install.ts";

const folders: string[] = [];
afterAll(async () => { for (const folder of folders) await removeTempDir(folder); });

describe("host setup", () => {
  it("pins the AppArmor exemption to one root-owned executable", () => {
    const profile = appArmorProfile("/opt/OpenMausBot/resources/chrome/chrome");
    expect(profile).toContain("profile openmausbot-chrome /opt/OpenMausBot/resources/chrome/chrome flags=(unconfined)");
    expect(profile).toContain("userns,");
    for (const path of ["/opt/**/chrome", "/home/a/chrome", "relative/chrome", "/opt/a b/chrome"]) expect(() => appArmorProfile(path)).toThrow();
  });

  it("names the sandbox when Chrome says it has none, and never turns it off by itself", async () => {
    const diagnosis = await diagnoseLaunchFailure({ executable: "/opt/chrome", output: "[0101/000000.000:FATAL:zygote_host_impl_linux.cc] No usable sandbox! ...", platform: "darwin", exists: () => false });
    expect(diagnosis).toBeInstanceOf(BrowserHostError);
    expect(diagnosis?.kind).toBe("sandbox");
    expect(diagnosis?.message).toContain(SANDBOX_STEPS_URL);
    expect(diagnosis?.message).not.toMatch(/browser setup/);
    // The linked steps exist, and the viewer offers the same link and command.
    expect(readFileSync(new URL("../../../docs/deploy-vps.md", import.meta.url), "utf8")).toMatch(/^### Ubuntu 24\.04 browser sandbox$/m);
    expect(SANDBOX_STEPS_URL.endsWith("/docs/deploy-vps.md#ubuntu-2404-browser-sandbox")).toBe(true);
    const viewer = readFileSync(new URL("../../../src/lib/browser-stream-client.ts", import.meta.url), "utf8");
    expect(viewer).toContain(`"${SANDBOX_STEPS_URL}"`);
    expect(viewer).toContain(`"${LIBRARIES_COMMAND}"`);
    expect(LIBRARIES_COMMAND).toBe("sudo openmausbot browser install --with-deps");
    expect(new BrowserHostError("libraries", ["libnss3.so"]).message).toContain(LIBRARIES_COMMAND);
    expect(await diagnoseLaunchFailure({ executable: "/opt/chrome", output: "something else", platform: "darwin" })).toBeNull();
    expect(sandboxDisabled({})).toBe(false);
    expect(sandboxDisabled({ OMB_BROWSER_SANDBOX: "0" })).toBe(true);
  });

  it("tells a container's operator how to run the browser without Chrome's sandbox, which cannot start there", async () => {
    const outputs = [
      // What Chrome prints as root, as in most containers (Railway, Docker's default user).
      "[1:1:1115/103658.971532:ERROR:content/browser/zygote_host/zygote_host_impl_linux.cc:101] Running as root without --no-sandbox is not supported. See https://crbug.com/638180.",
      "[0101/000000.000:FATAL:zygote_host_impl_linux.cc] No usable sandbox! ...",
      "Failed to move to new namespace: PID namespaces supported, Network namespace supported, but failed: errno = Operation not permitted",
    ];
    const inContainer = (path: string) => path === "/.dockerenv";
    for (const output of outputs) {
      const diagnosis = await diagnoseLaunchFailure({ executable: "/opt/chrome", output, platform: "darwin", exists: inContainer });
      expect(diagnosis?.kind).toBe("container");
      expect(diagnosis?.message).toBe("Chrome's sandbox can't start in this container. The operator can set OMB_BROWSER_SANDBOX=0 to run the browser without it and rely on the container's isolation, then restart OpenMausBot.");
    }
    // Root needs no container marker; a sandbox the host blocks elsewhere keeps the AppArmor steps.
    expect((await diagnoseLaunchFailure({ executable: "/opt/chrome", output: outputs[0]!, platform: "darwin", exists: () => false }))?.kind).toBe("container");
    expect((await diagnoseLaunchFailure({ executable: "/opt/chrome", output: outputs[1]!, platform: "darwin", exists: () => false }))?.kind).toBe("sandbox");
    // The diagnosis is found behind the errors that carry it to a viewer.
    const host = new BrowserHostError("container");
    expect(hostSetupOf(new Error("Chrome could not be started", { cause: new Error("launch", { cause: host }) }))).toBe(host);
    expect(hostSetupOf(new Error("Chrome could not be started"))).toBeNull();
  });

  it.skipIf(process.platform === "win32")("asks the browser's own loader which libraries are missing, in the environment the browser launched with", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-host-setup-test-"));
    folders.push(dir);
    const chrome = join(dir, "chrome");
    writeFileSync(chrome, `#!/bin/sh\nprintf '%s' "$HOME" > '${dir}/home'\necho "chrome: error while loading shared libraries: libnss3.so: cannot open shared object file" >&2\nexit 127\n`, { mode: 0o755 });
    const env = { PATH: "/usr/bin:/bin", HOME: "/home/someone" };
    expect(await missingLibraries(chrome, env)).toEqual(["libnss3.so"]);
    expect(readFileSync(join(dir, "home"), "utf8")).toBe("/home/someone");
    expect(await diagnoseLaunchFailure({ executable: chrome, output: "", platform: "linux", env })).toMatchObject({ kind: "libraries", libraries: ["libnss3.so"] });
  });

  it("sees a blocked sandbox only where user namespaces are restricted and no profile is installed", () => {
    const read = (path: string) => (path === USERNS_RESTRICTION ? "1\n" : "");
    expect(sandboxBlocked({ platform: "linux", read, exists: () => false })).toBe(true);
    expect(sandboxBlocked({ platform: "linux", read, exists: () => true })).toBe(false);
    expect(sandboxBlocked({ platform: "linux", read: () => "0", exists: () => false })).toBe(false);
    expect(sandboxBlocked({ platform: "darwin", read, exists: () => false })).toBe(false);
  });

  it("writes a root step that pins the sandbox exemption to the pinned Chrome for Testing it installs", () => {
    const pin = chromeForTestingPin("linux", "x64")!;
    const script = sandboxSetupScript(pin);
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain(`https://storage.googleapis.com/chrome-for-testing-public/${pin.version}/linux64/chrome-linux64.zip`);
    expect(script).toContain(`echo "${pin.sha256}  $work/chrome.zip" | sha256sum -c -`);
    expect(script).toContain(appArmorProfile(sandboxChromeExecutable(pin)));
    expect(sandboxChromeExecutable(pin)).toBe(`/opt/openmausbot-browser/chrome-${pin.version}/chrome`);
    expect(() => sandboxSetupScript({ ...pin, version: "1; rm -rf /" })).toThrow();
    expect(() => sandboxSetupScript({ ...pin, sha256: "$(id)" })).toThrow();
    expect(new BrowserHostError("sandbox").message).toContain("openmausbot service install");
  });

  it.skipIf(process.platform === "win32")("the root step installs Chrome once, checked, drops older copies and loads the profile; it does nothing where namespaces are free", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-sandbox-script-"));
    folders.push(dir);
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const payload = "pretend chrome archive";
    const pin = { ...chromeForTestingPin("linux", "x64")!, sha256: createHash("sha256").update(payload).digest("hex") };
    const fake = (name: string, body: string) => writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    fake("curl", `while [ "$1" != -o ]; do shift; done; printf '%s' "$(cat '${dir}/payload')" > "$2"; echo curl >> '${dir}/calls'`);
    fake("unzip", `mkdir -p "$4/chrome-linux64" && printf '#!/bin/sh\\n' > "$4/chrome-linux64/chrome" && chmod 755 "$4/chrome-linux64/chrome"`);
    fake("apparmor_parser", `echo "apparmor_parser $*" >> '${dir}/calls'`);
    fake("install", `for last; do :; done; mkdir -p "$last"`);
    fake("chown", ":");
    writeFileSync(join(dir, "payload"), payload);
    const restriction = join(dir, "restrict");
    const root = join(dir, "opt");
    const profile = join(dir, "apparmor-profile");
    const local = sandboxSetupScript(pin).replaceAll(USERNS_RESTRICTION, restriction).replaceAll(SANDBOX_CHROME_ROOT, root).replaceAll(APPARMOR_PROFILE_PATH, profile);
    writeFileSync(join(dir, "step.sh"), local, { mode: 0o755 });
    const run = () => spawnSync("sh", [join(dir, "step.sh")], { encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin` } });
    const calls = () => existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8").trim().split("\n") : [];

    writeFileSync(restriction, "0\n");
    expect(run().status).toBe(0);
    expect(existsSync(root)).toBe(false);

    writeFileSync(restriction, "1\n");
    mkdirSync(join(root, "chrome-150.0.1.2"), { recursive: true });
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const executable = join(root, `chrome-${pin.version}`, "chrome");
    expect(existsSync(executable)).toBe(true);
    expect(existsSync(join(root, "chrome-150.0.1.2"))).toBe(false);
    expect(readFileSync(profile, "utf8")).toContain(`profile openmausbot-chrome ${executable} flags=(unconfined)`);
    expect(calls()).toEqual(["curl", `apparmor_parser -r ${profile}`]);

    expect(run().status).toBe(0);
    expect(calls()).toEqual(["curl", `apparmor_parser -r ${profile}`, `apparmor_parser -r ${profile}`]);

    writeFileSync(join(dir, "payload"), "tampered");
    spawnSync("rm", ["-rf", join(root, `chrome-${pin.version}`)]);
    const tampered = run();
    expect(tampered.status).not.toBe(0);
    expect(tampered.stdout + tampered.stderr).toContain("failed its SHA-256 check");
    expect(existsSync(executable)).toBe(false);
  });
});
