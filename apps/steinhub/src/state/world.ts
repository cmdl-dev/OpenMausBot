import type { InboxRow } from "@openmausbot/phone-protocol/inbox.ts";
import { useMemo } from "react";
import * as sample from "@/sample/world";
import { useConnection } from "@/state/connection";
import {
  automationView,
  botSections,
  botView,
  formatDate,
  initials,
  messageViews,
  taskOf,
  threadViews,
  type AutomationView,
  type BotSection,
  type BotView,
  type ComputerView,
  type HostView,
  type MessageView,
  type PersonView,
  type ThreadView,
} from "@/state/views";
import type { Status } from "@/theme";

export interface ThreadDetail {
  thread: ThreadView | null;
  bot: BotView | null;
  messages: MessageView[];
  loaded: boolean;
  hasMore: boolean;
}

/** Everything the screens draw, from the paired computer or from the sample world in demo mode. */
export interface World {
  source: "demo" | "live";
  bots: BotView[];
  sections: BotSection[];
  threads: ThreadView[];
  /** null when the computer doesn't say who its person is. */
  person: PersonView | null;
  host: HostView & { status: { label: string; tone: Status } };
  inbox: InboxRow[];
  /** The clock inbox rows are aged against; the sample inbox keeps its own morning. */
  inboxNow: number;
  /** The computer serves no inbox to phones yet, so the inbox shows the sample world even when paired. */
  inboxIsSample: boolean;
  automations: AutomationView[];
  automationsLoaded: boolean;
  computers: ComputerView[];
  /** Only the paired computer is known; the computer serves no list of the others to phones yet. */
  computersPartial: boolean;
  detail(threadId: string | undefined): ThreadDetail;
  bot(botId: string | undefined): BotView | null;
}

const LINK_STATUS = {
  online: { label: "Online", tone: "success" },
  connecting: { label: "Connecting…", tone: "info" },
  offline: { label: "Offline", tone: "danger" },
  "signed-out": { label: "Not paired", tone: "danger" },
  "update-app": { label: "Not reachable", tone: "danger" },
} as const;

function demoWorld(): World {
  const automations = sample.automations.map((automation) => (automation.runs.length ? automation : { ...automation, runs: sample.runs }));
  return {
    source: "demo",
    bots: sample.bots,
    sections: botSections(sample.bots, []),
    threads: sample.threads,
    person: sample.user,
    host: { ...sample.host, status: { label: "Online", tone: "success" } },
    inbox: sample.inbox,
    inboxNow: sample.SAMPLE_NOW,
    inboxIsSample: false,
    automations,
    automationsLoaded: true,
    computers: sample.computers,
    computersPartial: false,
    detail(threadId) {
      const thread = sample.threadById(threadId);
      return {
        thread,
        bot: sample.botById(thread.botId),
        messages: thread.id === "lease" ? sample.leaseMessages : [],
        loaded: true,
        hasMore: false,
      };
    },
    bot: (botId) => sample.botById(botId),
  };
}

export function useWorld(): World {
  const { mode, world, session, link } = useConnection();

  return useMemo(() => {
    if (mode !== "live" || !session) return demoWorld();
    const bots = world.bots.map((bot, index) => botView(bot, index, world.modelLabels));
    const threads = threadViews(world.bots);
    const hostName = world.host?.serverName ?? session.serverName;
    const version = world.host?.version;
    const status = LINK_STATUS[link];
    const findBot = (botId: string | undefined) => bots.find((bot) => bot.id === botId) ?? null;
    return {
      source: "live",
      bots,
      sections: botSections(bots, world.sections),
      threads,
      person: null,
      host: {
        name: hostName,
        app: version ? `OpenMausBot ${version}` : "OpenMausBot",
        paired: formatDate(session.pairedAt),
        status,
      },
      inbox: sample.inbox,
      inboxNow: sample.SAMPLE_NOW,
      inboxIsSample: true,
      automations: world.routines.map((routine) => automationView(routine, world.runs, hostName)),
      automationsLoaded: world.routinesLoaded,
      computers: [
        {
          id: "host",
          name: hostName,
          kind: "desktop",
          os: version ? `OpenMausBot ${version}` : "OpenMausBot",
          isHost: true,
          state: status,
          botIds: bots.map((bot) => bot.id),
        },
      ],
      computersPartial: true,
      detail(threadId) {
        const owner = threadId ? taskOf(world.bots, threadId) : null;
        const state = threadId ? world.threads[threadId] : undefined;
        return {
          thread: threads.find((thread) => thread.id === threadId) ?? (owner ? { id: owner.task.threadId, title: owner.task.title, botId: owner.bot.id, group: "Today" } : null),
          bot: findBot(owner?.bot.id),
          messages: messageViews(state?.messages ?? [], {
            streaming: threadId ? world.streaming[threadId] : undefined,
            pending: threadId ? world.pending[threadId] : undefined,
            busy: owner?.task.busy === true,
          }),
          loaded: state?.loaded === true,
          hasMore: state?.hasMore === true,
        };
      },
      bot: findBot,
    };
  }, [mode, world, session, link]);
}

export function personInitials(person: PersonView | null, fallback: string): string {
  return person?.initials ?? initials(fallback);
}
