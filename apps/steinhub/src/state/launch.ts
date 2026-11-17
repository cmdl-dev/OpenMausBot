import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import type { BotView, ThreadView } from "@/state/views";
import { useWorld } from "@/state/world";

/** The conversation the app opens to: the Chief of Staff's open one, else its latest thread. */
export function chiefThreadId(bots: readonly BotView[], threads: readonly ThreadView[]): string | null {
  const chief = bots.find((bot) => bot.chief && !bot.section) ?? bots.find((bot) => bot.chief);
  if (!chief) return null;
  return chief.threadId ?? threads.find((thread) => thread.botId === chief.id)?.id ?? null;
}

/** Once per launch, a paired app that would open on a blank new chat opens the Chief of Staff's conversation
 * instead, as soon as the computer's bots arrive. A launch into any other screen stays there. */
export function useOpenChiefOnLaunch(): void {
  const world = useWorld();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const settled = useRef(false);

  useEffect(() => {
    if (settled.current || world.source !== "live") return;
    if (pathname !== "/" || Object.keys(params).length > 0) {
      settled.current = true;
      return;
    }
    if (world.bots.length === 0) return;
    settled.current = true;
    const threadId = chiefThreadId(world.bots, world.threads);
    if (threadId) router.replace({ pathname: "/chat/[id]", params: { id: threadId } });
  }, [world, pathname, params]);
}
