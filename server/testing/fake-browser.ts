// A fixture server whose bots' browser is the driver's fake Chrome (fake-browser-hooks.mjs): the node argument that loads
// it and its environment. With `gated`, a preview capture waits for `<folder>/capture.gate`.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const FAKE_BROWSER_HOOK = pathToFileURL(join(import.meta.dirname, "fake-browser-hooks.mjs")).href;

export function fakeBrowserEnv(folder: string, { gated = false }: { gated?: boolean } = {}): Record<string, string> {
  if (!gated) writeFileSync(join(folder, "capture.gate"), "open");
  return { OMB_TEST_FAKE_BROWSER: folder, OMB_CHROME_PATH: process.execPath };
}
