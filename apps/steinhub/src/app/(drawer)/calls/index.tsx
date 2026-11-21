import { router, useLocalSearchParams } from "expo-router";
import { Phone } from "lucide-react-native";
import { StyleSheet } from "react-native";
import type { CallSummary } from "@/api/client";
import { Group, Row } from "@/components/list";
import { Screen } from "@/components/screen";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { useConnection } from "@/state/connection";
import { useLoaded } from "@/state/use-loaded";
import { callState, formatWhen } from "@/state/views";
import { useWorld } from "@/state/world";
import { colors, size, space } from "@/theme";

const iconProps = { size: size.icon, color: colors.text2, strokeWidth: size.iconStroke };

export default function CallsScreen() {
  const { bot: botId } = useLocalSearchParams<{ bot?: string }>();
  const world = useWorld();
  const { calls } = useConnection();
  const bot = world.bot(botId);
  const loaded = useLoaded(calls, world.source, world.host.name);
  const shown = loaded.state === "ready" ? loaded.value.filter((call: CallSummary) => !botId || call.botId === botId) : [];

  return (
    <Screen header={<PageTopBar leading="back" />} refresh={{ refreshing: loaded.reloading, onRefresh: loaded.reload }}>
      <LargeTitle>Phone calls</LargeTitle>
      <Txt variant="subhead" tone="secondary" style={styles.lede}>
        {`The calls ${bot?.name ?? "your bots"} placed for you, with what was said.`}
      </Txt>
      {loaded.state === "loading" ? (
        <Txt variant="subhead" tone="tertiary" style={styles.note}>
          Loading…
        </Txt>
      ) : loaded.state === "failed" ? (
        <Txt variant="subhead" style={[styles.note, styles.problem]}>
          {loaded.problem}
        </Txt>
      ) : shown.length === 0 ? (
        <Txt variant="subhead" tone="tertiary" style={styles.note}>
          {bot ? `${bot.name} hasn't made any calls yet.` : "Your bots haven't made any calls yet."}
        </Txt>
      ) : (
        <Group>
          {shown.map((call) => (
            <Row
              key={call.id}
              title={call.calleeName ?? call.to}
              subtitle={`${formatWhen(call.createdAt)} · ${callState(call)}${botId ? "" : ` · ${call.botName}`}`}
              leading={<Phone {...iconProps} />}
              chevron
              onPress={() => router.push({ pathname: "/calls/[id]", params: { id: call.id } })}
            />
          ))}
        </Group>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: { paddingHorizontal: space[5], paddingBottom: space[3] },
  note: { textAlign: "center", marginTop: space[8], paddingHorizontal: space[6] },
  problem: { color: colors.danger },
});
