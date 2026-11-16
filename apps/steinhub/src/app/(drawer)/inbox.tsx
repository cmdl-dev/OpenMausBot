import type { InboxTab } from "@openmausbot/phone-protocol/inbox.ts";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Avatar } from "@/components/avatar";
import { Chip } from "@/components/chip";
import { Group, Row } from "@/components/list";
import { Screen } from "@/components/screen";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { botById, inbox } from "@/sample/world";
import { space } from "@/theme";

const TABS: { tab: InboxTab; label: string }[] = [
  { tab: "needs-you", label: "Needs you" },
  { tab: "info", label: "Info" },
  { tab: "done", label: "Done" },
];

export default function InboxScreen() {
  const [tab, setTab] = useState<InboxTab>("needs-you");
  const rows = inbox.filter((row) => row.tab === tab);

  return (
    <Screen header={<PageTopBar leading="menu" />}>
      <LargeTitle>Inbox</LargeTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {TABS.map((option) => (
          <Chip
            key={option.tab}
            label={option.label}
            count={inbox.filter((row) => row.tab === option.tab).length}
            selected={option.tab === tab}
            onPress={() => setTab(option.tab)}
          />
        ))}
      </ScrollView>
      {rows.length === 0 ? (
        <Txt variant="subhead" tone="tertiary" style={styles.empty}>
          Nothing here.
        </Txt>
      ) : (
        <Group>
          {rows.map((row) => {
            const bot = botById(row.from.botId);
            const origin = row.origin;
            return (
              <Row
                key={row.id}
                title={row.from.name}
                subtitle={row.text}
                leading={<Avatar label={bot.name} tint={bot.tint} />}
                chevron
                onPress={origin ? () => router.navigate({ pathname: "/chat/[id]", params: { id: origin.threadId } }) : undefined}
              />
            );
          })}
        </Group>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { gap: space[2], paddingHorizontal: space[4], paddingBottom: space[4] },
  empty: { textAlign: "center", marginTop: space[10] },
});
