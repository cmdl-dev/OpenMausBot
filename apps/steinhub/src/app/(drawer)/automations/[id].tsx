import { useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { Group, Row, SectionLabel } from "@/components/list";
import { Screen } from "@/components/screen";
import { Badge, StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { PageTopBar } from "@/components/top-bar";
import { automationById, botById, runs } from "@/sample/world";
import { space } from "@/theme";

const STATE_BADGE = {
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
} as const;

export default function AutomationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const automation = automationById(id);
  const bot = botById(automation.botId);
  const badge = STATE_BADGE[automation.state];
  const isSchedule = automation.trigger.kind === "schedule";

  return (
    <Screen header={<PageTopBar leading="back" title="Automation" />}>
      <View style={styles.hero}>
        <Badge label={badge.label} tone={badge.tone} />
        <Txt variant="title">{automation.name}</Txt>
      </View>

      <Group>
        <Row title="Bot" value={bot.name} leading={<Avatar label={bot.name} tint={bot.tint} size="sm" />} />
        <Row title={isSchedule ? "Schedule" : "When"} value={automation.trigger.label} />
        {automation.trigger.kind === "schedule" ? (
          <Row title="Cron" trailing={<Txt variant="footnote" tone="secondary" mono>{automation.trigger.cron}</Txt>} />
        ) : null}
        <Row title="Runs on" value={automation.runsOn} />
      </Group>

      <View style={styles.actions}>
        <View style={styles.fill}>
          <Button label={isSchedule ? "Run now" : "Test with last event"} variant="secondary" block />
        </View>
        <View style={styles.fill}>
          <Button label={automation.state === "active" ? "Pause" : "Resume"} variant="outline" block />
        </View>
      </View>

      <SectionLabel>Run history</SectionLabel>
      <Group>
        {runs.map((run) => (
          <Row key={run.id} title={run.at} subtitle={run.summary} leading={<StatusDot tone={run.outcome} />} chevron />
        ))}
      </Group>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[4], gap: space[2] },
  actions: { flexDirection: "row", gap: space[2], paddingHorizontal: space[4], paddingTop: space[4] },
  fill: { flex: 1 },
});
