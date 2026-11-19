// The bots' browsers ran on agent-browser before OpenMausBot's own Chrome driver. Its profiles, saved sign-ins, key,
// launcher and binary are no use to the Chrome driver, which keeps profiles of its own, so they are deleted once, with
// plain file deletion: bots sign in again. Only what OpenMausBot made goes; ~/.agent-browser is shared with any
// agent-browser the person runs themselves, so only its encrypted saved sessions (OpenMausBot always encrypted them)
// and OpenMausBot's config file there are removed.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MARKER = join("browser", "agent-browser-removed");
const SAVED_SESSION = /\.json\.enc(?:\.previous)?$/u;
const PENDING_SESSION = /-candidate-[0-9]+\.json\.enc$/u;

export interface OldEngineCleanup {
  dataDir: string;
  home?: string;
  log?: (line: string) => void;
}

function remove(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  return true;
}

function removeMatching(directory: string, pattern: RegExp): number {
  let names: string[];
  try { names = readdirSync(directory); } catch { return 0; }
  let removed = 0;
  for (const name of names) if (pattern.test(name) && remove(join(directory, name))) removed += 1;
  return removed;
}

/** True once everything is gone, now or on an earlier start; a failure is retried on the next start. */
export function removeOldEngineFiles({ dataDir, home = homedir(), log = console.info }: OldEngineCleanup): boolean {
  const marker = join(dataDir, MARKER);
  if (existsSync(marker)) return true;
  try {
    const sessions = join(home, ".agent-browser", "sessions");
    const removed = [
      join(dataDir, "agent-browser-profiles"),
      join(dataDir, "tools", "agent-browser"),
      join(dataDir, "browser-engine-key"),
      join(dataDir, "browser", "chrome-launcher.sh"),
      join(dataDir, "browser", "chrome-launcher.cmd"),
      join(home, ".agent-browser", "omb-managed-config.json"),
    ].filter(remove).length
      + removeMatching(sessions, SAVED_SESSION)
      + removeMatching(join(sessions, ".tmp"), PENDING_SESSION);
    mkdirSync(dirname(marker), { recursive: true, mode: 0o700 });
    writeFileSync(marker, `${new Date().toISOString()}\n`, { mode: 0o600 });
    if (removed > 0) log(`browser: removed ${removed} file${removed === 1 ? "" : "s"} the old agent-browser engine left; bots sign in to sites again`);
    return true;
  } catch (error) {
    log(`browser: could not remove what the old agent-browser engine left (${error instanceof Error ? error.message : String(error)}); trying again on the next start`);
    return false;
  }
}
