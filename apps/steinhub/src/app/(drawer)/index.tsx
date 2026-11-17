import { router, useLocalSearchParams } from "expo-router";
import { Calendar, Inbox, Mail, PenLine, type LucideIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { problemText } from "@/api/errors";
import { Avatar } from "@/components/avatar";
import { Chip } from "@/components/chip";
import { Composer } from "@/components/composer";
import { Screen } from "@/components/screen";
import { StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { ChatTopBar } from "@/components/top-bar";
import { useConnection } from "@/state/connection";
import { usePreferences } from "@/state/preferences";
import { useWorld } from "@/state/world";
import { colors, space } from "@/theme";

const CHIP_ICONS: LucideIcon[] = [Mail, Calendar, Inbox, PenLine];

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomeScreen() {
  const world = useWorld();
  const { send } = useConnection();
  const { bot: requestedBot, draft: requestedDraft } = useLocalSearchParams<{ bot?: string; draft?: string }>();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (requestedBot) setChosenId(requestedBot);
  }, [requestedBot]);
  useEffect(() => {
    if (requestedDraft) setDraft(requestedDraft);
  }, [requestedDraft]);
  const [error, setError] = useState<string | null>(null);
  const { defaultBot } = usePreferences();
  const bot = (chosenId ? world.bot(chosenId) : null) ?? (defaultBot ? world.bot(defaultBot) : null) ?? world.bots[0] ?? null;
  const firstName = world.person?.name.split(" ")[0];
  const unread = world.inboxIsSample ? world.bots.some((candidate) => candidate.state.tone === "warning") : world.inbox.some((row) => row.unread);

  async function sendFirst(text: string) {
    if (!bot) return;
    setError(null);
    if (world.source === "demo") {
      router.navigate({ pathname: "/chat/[id]", params: { id: "lease" } });
      return;
    }
    try {
      const threadId = await send(bot.id, null, text);
      router.navigate({ pathname: "/chat/[id]", params: { id: threadId } });
    } catch (failure) {
      setError(problemText(failure, world.host.name));
      throw failure;
    }
  }

  return (
    <Screen
      scroll={false}
      header={<ChatTopBar botName={bot?.name ?? world.host.name} right="inbox" unread={unread} onPressTitle={bot ? () => router.push({ pathname: "/sheets/bot-picker", params: { selected: bot.id } }) : undefined} />}
      footer={
        bot ? (
          <View>
            {error ? (
              <Txt variant="footnote" style={styles.error}>
                {error}
              </Txt>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {bot.suggestions.map((suggestion, index) => (
                <Chip key={suggestion} label={suggestion} icon={CHIP_ICONS[index % CHIP_ICONS.length]} onPress={() => setDraft(suggestion)} />
              ))}
            </ScrollView>
            <Composer botName={bot.name} text={draft} onChangeText={setDraft} onSend={sendFirst} />
          </View>
        ) : null
      }
    >
      <View style={styles.empty}>
        {bot ? (
          <>
            <Avatar bot={bot} label={bot.glyph} tint={bot.tint} size="hero" />
            <Txt variant="display" style={styles.center}>
              {firstName ? `${greeting(new Date().getHours())}, ${firstName}` : greeting(new Date().getHours())}
            </Txt>
            <Txt variant="callout" tone="secondary" style={styles.role} numberOfLines={2}>
              {bot.role ? `${bot.name} · ${bot.role}` : bot.name}
            </Txt>
          </>
        ) : (
          <Txt variant="callout" tone="secondary" style={styles.center}>
            {world.host.status.tone === "success" ? `No bots on ${world.host.name} yet. Make one there first.` : `Waiting for ${world.host.name}…`}
          </Txt>
        )}
        <View style={styles.hostLine}>
          <StatusDot tone={world.host.status.tone} />
          <Txt variant="footnote" tone="secondary">
            {world.host.name}
          </Txt>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[2], paddingHorizontal: space[6] },
  center: { textAlign: "center", marginTop: space[3] },
  role: { textAlign: "center" },
  hostLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: space[2] },
  chips: { gap: space[2], paddingHorizontal: space[3], paddingTop: space[2] },
  error: { color: colors.danger, paddingHorizontal: space[4], paddingTop: space[2] },
});
