import { useLocalSearchParams } from "expo-router";
import { ChevronRight, Clock, Pause, Play, Zap } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { problemText } from "@/api/errors";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { Group, SectionLabel } from "@/components/list";
import { Screen } from "@/components/screen";
import { Badge, StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { PageTopBar } from "@/components/top-bar";
import { useConnection } from "@/state/connection";
import { useWorld } from "@/state/world";
import { colors, radius, size, space } from "@/theme";

const STATE_BADGE = {
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
} as const;

export default function AutomationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const world = useWorld();
  const { runRoutine, setRoutineEnabled } = useConnection();
  const [busy, setBusy] = useState<"run" | "toggle" | null>(null);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  const automation = world.automations.find((candidate) => candidate.id === id) ?? (world.source === "demo" ? world.automations[0] : undefined);

  if (!automation) {
    return (
      <Screen header={<PageTopBar leading="back" />}>
        <Txt variant="subhead" tone="tertiary" style={styles.empty}>
          {world.automationsLoaded ? "This automation isn't on the computer any more." : "Loading…"}
        </Txt>
      </Screen>
    );
  }

  const bot = world.bot(automation.botId);
  const badge = STATE_BADGE[automation.state];
  const isSchedule = automation.trigger.kind === "schedule";
  const live = world.source === "live";
  const active = automation.state === "active";
  const TriggerIcon = isSchedule ? Clock : Zap;

  async function act(kind: "run" | "toggle") {
    if (!live || !automation) return;
    setBusy(kind);
    setNote(null);
    try {
      if (kind === "run") {
        await runRoutine(automation.id);
        setNote({ text: "Started. The result lands in its conversation.", failed: false });
      } else {
        await setRoutineEnabled(automation.id, !active);
      }
    } catch (error) {
      setNote({ text: problemText(error, world.host.name), failed: true });
    } finally {
      setBusy(null);
    }
  }

  const runButton = (
    <Button
      label={busy === "run" ? "Starting…" : isSchedule ? "Run now" : "Test with last event"}
      icon={active ? Play : undefined}
      variant={active ? "primary" : "secondary"}
      block
      disabled={busy !== null}
      onPress={() => void act("run")}
    />
  );
  const toggleButton = (
    <Button
      label={active ? "Pause" : "Resume"}
      icon={active ? Pause : Play}
      variant={active ? "secondary" : "primary"}
      block
      disabled={busy !== null}
      onPress={() => void act("toggle")}
    />
  );

  return (
    <Screen header={<PageTopBar leading="back" />}>
      <View style={styles.hero}>
        <Avatar bot={bot} label={bot?.glyph ?? "?"} tint={bot?.tint} />
        <View style={styles.fill}>
          <Txt variant="title" numberOfLines={2}>
            {automation.name}
          </Txt>
          <View style={styles.meta}>
            <TriggerIcon size={14} color={colors.text2} strokeWidth={size.iconStroke} />
            <Txt variant="footnote" tone="secondary" numberOfLines={1}>
              {isSchedule ? automation.trigger.label : "App event"} · {bot?.name ?? "Removed bot"}
            </Txt>
          </View>
        </View>
        {automation.state === "failed" ? null : <Badge label={badge.label} tone={badge.tone} />}
      </View>

      {automation.state === "failed" ? (
        <View style={styles.banner}>
          <Pause size={16} color={colors.warning} strokeWidth={size.iconStroke} />
          <View style={styles.fill}>
            <Txt variant="callout" weight="600" style={{ color: colors.warning }}>
              Paused after {automation.failureStreak ?? 2} failed runs
            </Txt>
            <Txt variant="footnote" tone="secondary">
              It won&apos;t run again until you resume it.
            </Txt>
          </View>
        </View>
      ) : null}

      <View style={styles.grid}>
        <Cell label="Bot" value={bot?.name ?? "Removed bot"} />
        <Cell label="Status" value={badge.label} tone={badge.tone} />
        <Cell label={isSchedule ? "Trigger" : "When"} value={automation.trigger.label} />
        <Cell label="Time zone" value={automation.timeZone ?? "This computer's"} />
        <Cell label="Next run" value={automation.next?.replace(/^Next /, "") ?? (active ? "Not scheduled" : "Paused")} />
        <Cell label="Runs on" value={automation.runsOn} />
      </View>

      <View style={styles.actions}>
        <View style={styles.fill}>{active ? runButton : toggleButton}</View>
        <View style={styles.fill}>{active ? toggleButton : runButton}</View>
      </View>
      {note ? (
        <Txt variant="footnote" tone="secondary" style={[styles.note, note.failed && styles.failed]}>
          {note.text}
        </Txt>
      ) : null}

      {automation.prompt ? (
        <>
          <SectionLabel>Instructions</SectionLabel>
          <View style={styles.instructions}>
            <Txt variant="callout">{automation.prompt}</Txt>
          </View>
        </>
      ) : null}

      <SectionLabel>Run history</SectionLabel>
      {automation.runs.length === 0 ? (
        <Txt variant="subhead" tone="tertiary" style={styles.noRuns}>
          No runs yet.
        </Txt>
      ) : (
        <Group>
          {automation.runs.map((run) => (
            <Pressable key={run.id} accessibilityRole="button" style={({ pressed }) => [styles.run, pressed && styles.pressed]}>
              <StatusDot tone={run.outcome} />
              <View style={styles.fill}>
                <Txt variant="callout">{run.at}</Txt>
                <Txt variant="footnote" numberOfLines={2} style={{ color: run.outcome === "danger" ? colors.danger : colors.text2 }}>
                  {run.summary}
                </Txt>
              </View>
              {run.duration ? (
                <Txt variant="footnote" tone="tertiary">
                  {run.duration}
                </Txt>
              ) : null}
              <ChevronRight size={16} color={colors.text3} strokeWidth={size.iconStroke} />
            </Pressable>
          ))}
        </Group>
      )}
    </Screen>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <View style={styles.cell}>
      <Txt variant="footnote" tone="tertiary">
        {label}
      </Txt>
      <View style={styles.meta}>
        {tone ? <StatusDot tone={tone} /> : null}
        <Txt variant="callout" numberOfLines={1} style={styles.fill}>
          {value}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hero: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[4] },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  banner: {
    flexDirection: "row",
    gap: space[3],
    marginHorizontal: space[4],
    marginBottom: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.lg,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cell: { width: "50%", paddingHorizontal: space[4], paddingVertical: space[2], gap: 2 },
  actions: { flexDirection: "row", gap: space[2], paddingHorizontal: space[4], paddingTop: space[4] },
  note: { paddingHorizontal: space[4], paddingTop: space[2] },
  failed: { color: colors.danger },
  instructions: {
    marginHorizontal: space[4],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  run: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3] },
  pressed: { backgroundColor: colors.surface2 },
  empty: { textAlign: "center", marginTop: space[10] },
  noRuns: { paddingHorizontal: space[4] },
});
