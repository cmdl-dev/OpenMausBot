import { router, useLocalSearchParams } from "expo-router";
import { Brain, Cpu, MessageSquare, Sparkles } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { Group, Row, SectionLabel } from "@/components/list";
import { Screen } from "@/components/screen";
import { StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { PageTopBar } from "@/components/top-bar";
import { botById, host, threads } from "@/sample/world";
import { colors, size, space } from "@/theme";

const iconProps = { size: size.icon, color: colors.text2, strokeWidth: size.iconStroke };

export default function BotProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bot = botById(id);
  const botThreads = threads.filter((thread) => thread.botId === bot.id);

  return (
    <Screen header={<PageTopBar leading="back" />}>
      <View style={styles.hero}>
        <Avatar label={bot.name} tint={bot.tint} size="lg" />
        <Txt variant="title">{bot.name}</Txt>
        <Txt variant="callout" tone="secondary">
          {bot.role}
        </Txt>
        <View style={styles.state}>
          <StatusDot tone={bot.state.tone} />
          <Txt variant="footnote" tone="secondary">
            {bot.state.label} · {host.name}
          </Txt>
        </View>
        <Button label="New chat" small onPress={() => router.navigate("/")} />
      </View>

      <SectionLabel>Setup</SectionLabel>
      <Group>
        <Row title="Model" value={bot.model} leading={<Cpu {...iconProps} />} chevron />
        <Row title="Memory" subtitle="What this bot remembers about you" leading={<Brain {...iconProps} />} chevron />
        <Row title="Skills" value="6" leading={<Sparkles {...iconProps} />} chevron />
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
  state: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: space[2] },
});
