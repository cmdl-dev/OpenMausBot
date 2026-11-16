import { router } from "expo-router";
import { Plus } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, StyleSheet, Switch } from "react-native";
import { Avatar } from "@/components/avatar";
import { Chip } from "@/components/chip";
import { Group, Row, SectionLabel } from "@/components/list";
import { Screen } from "@/components/screen";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { automations, botById, host, type SampleAutomation } from "@/sample/world";
import { colors, space } from "@/theme";

type Filter = "all" | SampleAutomation["state"];

const FILTERS: { filter: Filter; label: string }[] = [
  { filter: "all", label: "All" },
  { filter: "active", label: "Active" },
  { filter: "paused", label: "Paused" },
  { filter: "failed", label: "Failed" },
];

function matches(automation: SampleAutomation, filter: Filter): boolean {
  return filter === "all" || automation.state === filter;
}

export default function AutomationsScreen() {
  const [filter, setFilter] = useState<Filter>("all");
  const visible = automations.filter((automation) => matches(automation, filter));
  const attention = visible.filter((automation) => automation.state !== "active");
  const active = visible.filter((automation) => automation.state === "active");

  return (
    <Screen header={<PageTopBar leading="menu" action={{ icon: Plus, label: "New automation" }} />}>
      <LargeTitle>Automations</LargeTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {FILTERS.map((option) => (
          <Chip
            key={option.filter}
            label={option.label}
            count={automations.filter((automation) => matches(automation, option.filter)).length}
            selected={option.filter === filter}
            onPress={() => setFilter(option.filter)}
          />
        ))}
      </ScrollView>
      {attention.length > 0 ? (
        <>
          <SectionLabel>Needs attention</SectionLabel>
          <AutomationGroup items={attention} />
        </>
      ) : null}
      {active.length > 0 ? (
        <>
          <SectionLabel>Active</SectionLabel>
          <AutomationGroup items={active} />
        </>
      ) : null}
      <Txt variant="footnote" tone="tertiary" style={styles.note}>
        Automations run in OpenMausBot on {host.name} unless set to another computer.
      </Txt>
    </Screen>
  );
}

function AutomationGroup({ items }: { items: SampleAutomation[] }) {
  return (
    <Group>
      {items.map((automation) => {
        const bot = botById(automation.botId);
        return (
          <Row
            key={automation.id}
            title={automation.name}
            subtitle={`${automation.trigger.label}\n${automation.lastRun.label}${automation.next ? ` · ${automation.next}` : ""}`}
            leading={<Avatar label={bot.name} tint={bot.tint} size="sm" />}
            trailing={
              <Switch
                accessibilityLabel={`${automation.name} on`}
                value={automation.state === "active"}
                trackColor={{ false: colors.surface3, true: colors.success }}
                thumbColor={colors.text}
              />
            }
            onPress={() => router.navigate({ pathname: "/automations/[id]", params: { id: automation.id } })}
          />
        );
      })}
    </Group>
  );
}

const styles = StyleSheet.create({
  chips: { gap: space[2], paddingHorizontal: space[4] },
  note: { paddingHorizontal: space[5], paddingTop: space[3] },
});
