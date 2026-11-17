import { router, useLocalSearchParams } from "expo-router";
import { CalendarDays, FileText } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import type { MemoryFile } from "@/api/client";
import { Group, Row, SectionLabel } from "@/components/list";
import { Markdown } from "@/components/markdown";
import { Screen } from "@/components/screen";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { useConnection } from "@/state/connection";
import { useLoaded } from "@/state/use-loaded";
import { formatDate } from "@/state/views";
import { useWorld } from "@/state/world";
import { colors, radius, size, space } from "@/theme";

const iconProps = { size: size.icon, color: colors.text2, strokeWidth: size.iconStroke };
const LOGS_SHOWN = 14;

function fileTitle(file: MemoryFile): string {
  return file.name.replace(/\.md$/i, "");
}

export default function MemoryScreen() {
  const { bot: botId } = useLocalSearchParams<{ bot: string }>();
  const world = useWorld();
  const { memory } = useConnection();
  const bot = world.bot(botId);
  const loaded = useLoaded(() => memory(botId), `${world.source}:${botId}`, world.host.name);

  function openFile(file: MemoryFile) {
    router.push({ pathname: "/memory/[bot]/file", params: { bot: botId, path: file.path } });
  }

  return (
    <Screen header={<PageTopBar leading="back" />}>
      <LargeTitle>Memory</LargeTitle>
      {bot ? (
        <Txt variant="subhead" tone="secondary" style={styles.lede}>
          {`What ${bot.name} keeps between conversations. It writes these itself as you talk; change them on the computer.`}
        </Txt>
      ) : null}
      {loaded.state === "loading" ? (
        <Txt variant="subhead" tone="tertiary" style={styles.note}>
          Loading…
        </Txt>
      ) : loaded.state === "failed" ? (
        <Txt variant="subhead" style={[styles.note, styles.problem]}>
          {loaded.problem}
        </Txt>
      ) : !loaded.value.text.trim() && loaded.value.topics.length === 0 && loaded.value.logs.length === 0 ? (
        <Txt variant="subhead" tone="tertiary" style={styles.note}>
          {`${bot?.name ?? "This bot"} doesn't remember anything yet.`}
        </Txt>
      ) : (
        <>
          {loaded.value.text.trim() ? (
            <View style={styles.doc} accessibilityLabel="MEMORY.md">
              <Markdown>{loaded.value.text}</Markdown>
            </View>
          ) : null}
          {loaded.value.topics.length ? (
            <>
              <SectionLabel>Topics</SectionLabel>
              <Group>
                {loaded.value.topics.map((file) => (
                  <Row
                    key={file.path}
                    title={fileTitle(file)}
                    subtitle={`Updated ${formatDate(file.modifiedAt)}`}
                    leading={<FileText {...iconProps} />}
                    chevron
                    onPress={() => openFile(file)}
                  />
                ))}
              </Group>
            </>
          ) : null}
          {loaded.value.logs.length ? (
            <>
              <SectionLabel>Daily notes</SectionLabel>
              <Group>
                {[...loaded.value.logs]
                  .sort((a, b) => b.name.localeCompare(a.name))
                  .slice(0, LOGS_SHOWN)
                  .map((file) => (
                    <Row key={file.path} title={fileTitle(file)} leading={<CalendarDays {...iconProps} />} chevron onPress={() => openFile(file)} />
                  ))}
              </Group>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: { paddingHorizontal: space[5], paddingBottom: space[3] },
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
