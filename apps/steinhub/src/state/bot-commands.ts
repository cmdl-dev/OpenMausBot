import type { Href } from "expo-router";
import { Alert } from "react-native";
import { problemText } from "@/api/errors";
import { useConnection } from "@/state/connection";
import type { BotView } from "@/state/views";
import { useWorld } from "@/state/world";

/** What the drawer and the bot menu both do to a bot, with a failure shown as an alert. */
export function useBotCommands() {
  const world = useWorld();
  const connection = useConnection();
  const live = world.source === "live";

  function failed(error: unknown) {
    Alert.alert("That didn't work", problemText(error, world.host.name));
  }

  async function newThread(bot: BotView, folderId?: string): Promise<Href | null> {
    if (!live) return { pathname: "/", params: { bot: bot.id } };
    try {
      const threadId = await connection.newThread(bot.id, folderId);
      return { pathname: "/chat/[id]", params: { id: threadId } };
    } catch (error) {
      failed(error);
      return null;
    }
  }

  return { live, failed, newThread };
}
