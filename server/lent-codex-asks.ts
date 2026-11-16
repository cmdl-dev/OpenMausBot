// Codex running a job on a lent computer asks before it uses each app there. The question comes back to the turn that
// sent the job as one plain card, Allow once or Deny, and the answer goes back to Codex on that computer. Pending asks
// live in memory; a card left by a previous run is closed at startup.
import { newId } from "./contracts.ts";
import { optionCardsForTools } from "./message-db.ts";
import { buildNotification } from "./notify.ts";
import type { CodexAppAccess } from "./shared-computers.ts";
import type { BotRecord } from "./store.ts";
import { turnWaitedOnPerson } from "./waiting-on-person.ts";
import type { YourComputerBus } from "./your-computer-consent.ts";

export const LENT_CODEX_TOOL = "lent_codex_app";

interface Pending {
  threadId: string;
  generation: string;
  messageId: string;
  botId?: string;
  bus: YourComputerBus;
  resolve: (allowed: boolean) => void;
}

const pending = new Map<string, Pending>();

function settle(entry: Pending, answer: "allow" | "deny", source: "user" | "system"): void {
  const { store } = entry.bus;
  const card = store.messagesFor(entry.threadId).find((message) => message.id === entry.messageId)?.card;
  if (card && !card.answered) {
    store.patchMessage(entry.threadId, entry.messageId, { card: { ...card, answered: answer, dismissed: source !== "user" } });
  }
  const task = entry.botId ? store.projectBotForTask(entry.botId, entry.threadId) : null;
  if (turnWaitedOnPerson(task)) store.setTaskActivity(task.id, entry.threadId, "working");
}

/** Settles true on Allow; false on Deny, or when `signal` ends the job first (the card is then closed). The answer covers that
 * app for the rest of the job: Codex asks again before every call. */
export function askLentCodexApp(
  bus: YourComputerBus,
  bot: Pick<BotRecord, "id" | "name" | "color" | "avatarUrl" | "notifications"> | undefined,
  owner: { threadId: string; generation: string },
  computer: string,
  access: CodexAppAccess,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  const { store } = bus;
  const title = `Let Codex on ${computer} use ${access.app}?`;
  const room = store.groupByThread(owner.threadId);
  const requestId = newId();
  return new Promise<boolean>((resolve) => {
    const message = store.appendMessage(owner.threadId, {
      role: "bot",
      kind: "options",
      ...(room && bot ? { from: { botId: bot.id, name: bot.name, color: bot.color } } : {}),
      card: {
        title,
        subtitle: `${bot?.name ?? "The bot"} gave Codex on ${computer} a job. Allowing covers ${access.app} until that job ends.`,
        options: ["Allow for this job", "Deny"],
        requestId,
        requestType: "permission",
        tool: LENT_CODEX_TOOL,
      },
    });
    const entry: Pending = { threadId: owner.threadId, generation: owner.generation, messageId: message.id, botId: bot?.id, bus, resolve };
    pending.set(requestId, entry);
    signal.addEventListener("abort", () => {
      if (!pending.delete(requestId)) return;
      settle(entry, "deny", "system");
      resolve(false);
    }, { once: true });
    if (bot) {
      const task = store.projectBotForTask(bot.id, owner.threadId);
      if (task?.busy) store.setTaskActivity(bot.id, owner.threadId, "waiting-on-you");
      bus.notify?.(buildNotification("approval", bot, owner.threadId, title, {
        avatarUrl: bot.avatarUrl, ...(room && !room.dm ? { group: { id: room.id, name: room.name } } : {}),
      }));
    }
  });
}

/** True when it settled one of these asks; call before handing an answer to the engine. */
export function resolveLentCodexAsk(requestId: string, behavior: string | undefined): boolean {
  const entry = pending.get(requestId);
  if (!entry) return false;
  pending.delete(requestId);
  const allowed = behavior === "allow";
  settle(entry, allowed ? "allow" : "deny", "user");
  entry.resolve(allowed);
  return true;
}

/** Closes what a request left open: every ask in the thread, or only its own generation's. */
export function cancelLentCodexAsks(threadId: string, generation?: string): void {
  for (const [requestId, entry] of pending) {
    if (entry.threadId !== threadId || (generation !== undefined && entry.generation !== generation)) continue;
    pending.delete(requestId);
    settle(entry, "deny", "system");
    entry.resolve(false);
  }
}

export function dismissStaleLentCodexCards(bus: YourComputerBus): number {
  const { store } = bus;
  let dismissed = 0;
  for (const { threadId, messageId } of optionCardsForTools([LENT_CODEX_TOOL])) {
    const card = store.messagesFor(threadId).find((message) => message.id === messageId)?.card;
    if (!card?.requestId || card.answered || card.dismissed || pending.has(card.requestId)) continue;
    if (store.patchMessage(threadId, messageId, { card: { ...card, answered: "deny", dismissed: true } })) dismissed += 1;
  }
  return dismissed;
}
