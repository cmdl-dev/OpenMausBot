import { router } from "expo-router";
import { Clock, Plus, Zap } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { problemText } from "@/api/errors";
import { Avatar } from "@/components/avatar";
import { Chip } from "@/components/chip";
import { Group, SectionLabel } from "@/components/list";
import { Badge, StatusDot } from "@/components/status";
import { Screen } from "@/components/screen";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { useConnection } from "@/state/connection";
import type { AutomationView } from "@/state/views";
import { useWorld, type World } from "@/state/world";
import { colors, radius, size, space } from "@/theme";

type Filter = "all" | AutomationView["state"];

const FILTERS: { filter: Filter; label: string }[] = [
  { filter: "all", label: "All" },
  { filter: "active", label: "Active" },
  { filter: "paused", label: "Paused" },
  { filter: "failed", label: "Failed" },
];

const STATE_BADGE = {
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
} as const;

/** A failed automation is paused too: it stopped after its failures. */
function matches(automation: AutomationView, filter: Filter): boolean {
  if (filter === "paused") return automation.state !== "active";
  return filter === "all" || automation.state === filter;
}

export default function AutomationsScreen() {
  const world = useWorld();
  const { automations } = world;
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
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
      {error ? (
        <Txt variant="footnote" style={styles.error}>
          {error}
        </Txt>
      ) : null}
      {!world.automationsLoaded ? (
        <Txt variant="subhead" tone="tertiary" style={styles.empty}>
          Loading…
        </Txt>
      ) : automations.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyTile}>
            <Clock size={24} color={colors.text} strokeWidth={size.iconStroke} />
          </View>
          <Txt variant="title">No automations yet</Txt>
          <Txt variant="callout" tone="secondary" style={styles.center}>
            Make one in OpenMausBot on {world.host.name}. Results land in your Inbox.
          </Txt>
        </View>
      ) : null}
      {attention.length > 0 ? (
        <>
          <SectionLabel>Needs attention</SectionLabel>
          <AutomationGroup items={attention} world={world} onError={setError} />
        </>
      ) : null}
      {active.length > 0 ? (
        <>
          <SectionLabel>Active</SectionLabel>
          <AutomationGroup items={active} world={world} onError={setError} />
        </>
      ) : null}
      <Txt variant="footnote" tone="tertiary" style={styles.note}>
        Automations run in OpenMausBot on {world.host.name} unless set to another computer.
      </Txt>
    </Screen>
  );
}

function AutomationGroup({ items, world, onError }: { items: AutomationView[]; world: World; onError: (text: string | null) => void }) {
  const { setRoutineEnabled } = useConnection();
  const [changing, setChanging] = useState<string | null>(null);

  async function toggle(automation: AutomationView, on: boolean) {
    if (world.source !== "live") return;
    onError(null);
    setChanging(automation.id);
    try {
      await setRoutineEnabled(automation.id, on);
    } catch (error) {
      onError(problemText(error, world.host.name));
    } finally {
      setChanging(null);
    }
  }

  return (
    <Group>
      {items.map((automation) => {
        const bot = world.bot(automation.botId);
        const badge = STATE_BADGE[automation.state];
        const TriggerIcon = automation.trigger.kind === "schedule" ? Clock : Zap;
        const trigger = automation.state === "active" ? automation.trigger.label : `${automation.trigger.label} · paused`;
        return (
          <Pressable
            key={automation.id}
            accessibilityRole="button"
            accessibilityLabel={automation.name}
            onPress={() => router.navigate({ pathname: "/automations/[id]", params: { id: automation.id } })}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Avatar bot={bot} label={bot?.glyph ?? "?"} tint={bot?.tint} size="sm" />
            <View style={styles.rowText}>
              <Txt variant="callout" numberOfLines={1}>
                {automation.name}
              </Txt>
              <View style={styles.meta}>
                <TriggerIcon size={13} color={colors.text3} strokeWidth={size.iconStroke} />
                <Txt variant="footnote" tone="secondary" numberOfLines={1} style={styles.fill}>
                  {trigger}
                </Txt>
              </View>
              <View style={styles.meta}>
                <StatusDot tone={automation.lastRun?.tone} />
                <Txt variant="caption" weight="400" tone="tertiary" numberOfLines={1} style={styles.fill}>
                  {automation.lastRun ? automation.lastRun.label : "Not run yet"}
                  {automation.next ? ` · ${automation.next}` : ""}
                </Txt>
              </View>
            </View>
            <View style={styles.trailing}>
              <Badge label={badge.label} tone={badge.tone} />
              <Switch
                accessibilityLabel={`${automation.name} on`}
                value={automation.state === "active"}
                disabled={changing === automation.id}
                onValueChange={(on) => void toggle(automation, on)}
                trackColor={{ false: colors.surface3, true: colors.success }}
                thumbColor={colors.text}
                style={styles.switch}
              />
            </View>
          </Pressable>
        );
      })}
    </Group>
  );
}

const styles = StyleSheet.create({
  chips: { gap: space[2], paddingHorizontal: space[4] },
  note: { paddingHorizontal: space[5], paddingTop: space[3] },
  empty: { textAlign: "center", marginTop: space[10] },
  emptyState: { alignItems: "center", gap: space[3], paddingTop: space[12], paddingHorizontal: space[6] },
  emptyTile: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space[2],
  },
  center: { textAlign: "center" },
  fill: { flex: 1 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3] },
  pressed: { backgroundColor: colors.surface2 },
  rowText: { flex: 1, gap: 2 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  trailing: { alignItems: "flex-end", gap: space[2] },
  switch: { transform: [{ scale: 0.8 }], marginRight: -4 },
  error: { color: colors.danger, paddingHorizontal: space[4], paddingTop: space[3] },
});
