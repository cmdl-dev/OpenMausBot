import { router, useLocalSearchParams } from "expo-router";
import { Brain, Cpu, MessageSquare } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { Group, Row, SectionLabel } from "@/components/list";
import { Screen } from "@/components/screen";
import { StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { PageTopBar } from "@/components/top-bar";
import { useWorld } from "@/state/world";
import { colors, size, space } from "@/theme";

const iconProps = { size: size.icon, color: colors.text2, strokeWidth: size.iconStroke };

export default function BotProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const world = useWorld();
  const bot = world.bot(id) ?? (world.source === "demo" ? world.bots[0] : null);
  if (!bot) {
    return (
      <Screen header={<PageTopBar leading="back" />}>
        <Txt variant="subhead" tone="tertiary" style={styles.missing}>
          This bot isn't on the computer any more.
        </Txt>
      </Screen>
    );
  }
  const botThreads = world.threads.filter((thread) => thread.botId === bot.id);

  return (
    <Screen header={<PageTopBar leading="back" />}>
      <View style={styles.hero}>
        <Avatar bot={bot} label={bot.glyph} tint={bot.tint} size="lg" />
        <Txt variant="title">{bot.name}</Txt>
        <Txt variant="callout" tone="secondary">
          {bot.role}
        </Txt>
        <View style={styles.state}>
          <StatusDot tone={bot.state.tone} />
          <Txt variant="footnote" tone="secondary">
            {bot.state.label} · {world.host.name}
          </Txt>
        </View>
        <Button label="New chat" small onPress={() => router.navigate({ pathname: "/", params: { bot: bot.id } })} />
      </View>

      <SectionLabel>Setup</SectionLabel>
      <Group>
        <Row title="Model" value={bot.model} leading={<Cpu {...iconProps} />} chevron onPress={() => router.push({ pathname: "/sheets/model", params: { bot: bot.id } })} />
        <Row
          title="Memory"
          subtitle="What this bot remembers about you"
          leading={<Brain {...iconProps} />}
          chevron
          onPress={() => router.push({ pathname: "/memory/[bot]", params: { bot: bot.id } })}
        />
      </Group>

      <SectionLabel>Threads</SectionLabel>
      <Group>
        {botThreads.map((thread) => (
          <Row
            key={thread.id}
            title={thread.title}
            subtitle={thread.group}
            leading={<MessageSquare {...iconProps} />}
            chevron
            onPress={() => router.navigate({ pathname: "/chat/[id]", params: { id: thread.id } })}
          />
        ))}
      </Group>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: space[2], paddingTop: space[4], paddingHorizontal: space[4] },
  missing: { textAlign: "center", marginTop: space[10] },
  state: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: space[2] },
});
