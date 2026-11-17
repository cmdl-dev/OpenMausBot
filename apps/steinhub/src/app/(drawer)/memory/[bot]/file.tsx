import { useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Markdown } from "@/components/markdown";
import { Screen } from "@/components/screen";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { useConnection } from "@/state/connection";
import { useLoaded } from "@/state/use-loaded";
import { useWorld } from "@/state/world";
import { colors, radius, space } from "@/theme";

export default function MemoryFileScreen() {
  const { bot: botId, path } = useLocalSearchParams<{ bot: string; path: string }>();
  const world = useWorld();
  const { memoryFile } = useConnection();
  const loaded = useLoaded(() => memoryFile(botId, path), `${world.source}:${botId}:${path}`, world.host.name);
  const title = (path.split("/").pop() ?? path).replace(/\.md$/i, "");

  return (
    <Screen header={<PageTopBar leading="back" />} refresh={{ refreshing: loaded.reloading, onRefresh: loaded.reload }}>
      <LargeTitle>{title}</LargeTitle>
      {loaded.state === "loading" ? (
        <Txt variant="subhead" tone="tertiary" style={styles.note}>
          Loading…
        </Txt>
      ) : loaded.state === "failed" ? (
        <Txt variant="subhead" style={[styles.note, styles.problem]}>
          {loaded.problem}
        </Txt>
      ) : !loaded.value.exists || !loaded.value.text.trim() ? (
        <Txt variant="subhead" tone="tertiary" style={styles.note}>
          This note is empty.
        </Txt>
      ) : (
        <View style={styles.doc}>
          <Markdown>{loaded.value.text}</Markdown>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { textAlign: "center", marginTop: space[8], paddingHorizontal: space[6] },
  problem: { color: colors.danger },
  doc: {
    marginHorizontal: space[4],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
});
