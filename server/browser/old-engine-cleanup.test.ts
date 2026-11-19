import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { removeOldEngineFiles } from "./old-engine-cleanup.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function world() {
  const root = mkdtempSync(join(tmpdir(), "omb-old-engine-"));
  roots.push(root);
  const dataDir = join(root, "data"), home = join(root, "home");
  const put = (path: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, "x"); return path; };
  return { dataDir, home, put };
}

describe("what agent-browser left", () => {
  it("is deleted once: its profiles, key, launcher, binary and encrypted sessions, and nothing of the person's own", () => {
    const { dataDir, home, put } = world();
    const leftovers = [
      put(join(dataDir, "agent-browser-profiles", "0123abcd", "Default", "Cookies")),
      put(join(dataDir, "tools", "agent-browser", "0.37.0", "agent-browser")),
      put(join(dataDir, "browser-engine-key")),
      put(join(dataDir, "browser", "chrome-launcher.sh")),
      put(join(home, ".agent-browser", "omb-managed-config.json")),
      put(join(home, ".agent-browser", "sessions", "bot-a-bot-a.json.enc")),
      put(join(home, ".agent-browser", "sessions", "bot-a-bot-a.json.enc.previous")),
      put(join(home, ".agent-browser", "sessions", ".tmp", "bot-a-bot-a-candidate-1.json.enc")),
    ];
    const kept = [
      put(join(home, ".agent-browser", "sessions", "mine.json")),
      put(join(home, ".agent-browser", "browsers", "chrome-153", "chrome")),
      put(join(dataDir, "tools", "chrome", "153", "linux64", "chrome-linux64", "chrome")),
      put(join(dataDir, "browser", "profiles", "p", "Default", "Cookies")),
    ];
    const lines: string[] = [];
    expect(removeOldEngineFiles({ dataDir, home, log: (line) => lines.push(line) })).toBe(true);
    for (const path of leftovers) expect(existsSync(path), path).toBe(false);
    for (const path of kept) expect(existsSync(path), path).toBe(true);
    expect(lines).toEqual(["browser: removed 8 files the old agent-browser engine left; bots sign in to sites again"]);
    // Once: a session the person saves with their own agent-browser later stays.
    const later = put(join(home, ".agent-browser", "sessions", "theirs-theirs.json.enc"));
    expect(removeOldEngineFiles({ dataDir, home, log: (line) => lines.push(line) })).toBe(true);
    expect(existsSync(later)).toBe(true);
    expect(lines).toHaveLength(1);
  });

  it("marks a fresh data folder as done without a word", () => {
    const { dataDir, home } = world();
    const lines: string[] = [];
    expect(removeOldEngineFiles({ dataDir, home, log: (line) => lines.push(line) })).toBe(true);
    expect(existsSync(join(dataDir, "browser", "agent-browser-removed"))).toBe(true);
    expect(lines).toEqual([]);
  });
});
