// The Docker image's Chrome for Testing: the build server/browser/chrome/install.ts pins for one Linux CPU, checked against
// its size and SHA-256 before it is unpacked into --out, with `chrome` at the top of --out naming its executable.
//   node scripts/prepare-chrome.ts --arch amd64|arm64 --out DIR
import { symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

import { chromeForTestingPin, installChromeForTesting } from "../server/browser/chrome/install.ts";

const { values } = parseArgs({ options: { arch: { type: "string" }, out: { type: "string" } } });
const arch = ({ amd64: "x64", x64: "x64", arm64: "arm64" } as Record<string, string>)[values.arch ?? ""];
if (!arch || !values.out) throw new Error("Usage: node scripts/prepare-chrome.ts --arch amd64|arm64 --out DIR");
const pin = chromeForTestingPin("linux", arch);
if (!pin) throw new Error(`No Chrome for Testing is pinned for linux-${arch}.`);
const executable = await installChromeForTesting({ dataDir: values.out, pin });
symlinkSync(relative(values.out, executable), join(values.out, "chrome"));
console.log(`Chrome for Testing ${pin.version} (${pin.platform}): ${executable}`);
