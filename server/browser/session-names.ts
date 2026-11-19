// The name of a bot's browser session: the bot's id or a profile's partition, or a random one for a temporary browser.
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { DATA_DIR } from "../config.ts";

/** Tagged with the data dir, so a temporary browser is recognisably this data dir's. */
function temporaryBrowserPrefix(dataDir: string): string {
  return `guest-${createHash("sha256").update(resolve(dataDir)).digest("hex").slice(0, 8)}-`;
}

/** Session ids are file-system and shell safe: a bot id or a profile partition. */
export function browserSessionId(botId: string, partitionId: string, dataDir = DATA_DIR): string {
  if (partitionId === "guest") return `${temporaryBrowserPrefix(dataDir)}${randomBytes(8).toString("hex")}`;
  const raw = partitionId || `bot-${botId}`;
  return raw.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 96);
}
