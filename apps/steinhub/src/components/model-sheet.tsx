import { Check } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { problemText } from "@/api/errors";
import { Sheet } from "@/components/sheet";
import { Txt } from "@/components/text";
import type { BotView, EngineView } from "@/state/views";
import { colors, radius, size, space } from "@/theme";

/** Pick the model a bot runs on, from every engine the computer has. */
export function ModelSheet({
  bot,
  engines,
  hostName,
  open,
  onPick,
  onClose,
}: {
  bot: BotView;
  engines: EngineView[];
  hostName: string;
  open: boolean;
  onPick: (selection: { instanceId: string; model: string }) => Promise<void>;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = bot.modelSelection;
  const usable = engines
    .filter((engine) => !engine.unavailable)
    .sort((a, b) => Number(b.instanceId === current?.instanceId) - Number(a.instanceId === current?.instanceId));
  const notSetUp = engines.filter((engine) => engine.unavailable).map((engine) => engine.name);

  async function pick(instanceId: string, model: string) {
    if (current?.instanceId === instanceId && current.model === model) return onClose();
    setSaving(`${instanceId}/${model}`);
    setError(null);
    try {
      await onPick({ instanceId, model });
      onClose();
    } catch (failure) {
      setError(problemText(failure, hostName));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={`Model for ${bot.name}`}
      scrolling={
        <ScrollView style={{ maxHeight: height * 0.6 }} contentContainerStyle={styles.list}>
          {engines.length === 0 ? (
            <Txt variant="subhead" tone="tertiary" style={styles.empty}>
              Loading the computer&apos;s engines…
            </Txt>
          ) : null}
          {usable.map((engine) => (
            <View key={engine.instanceId} style={styles.engine}>
              <Txt variant="overline" tone="secondary" style={styles.engineName}>
                {engine.name}
              </Txt>
              {engine.models.map((model) => {
                const key = `${engine.instanceId}/${model.id}`;
                const selected = current?.instanceId === engine.instanceId && current.model === model.id;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    disabled={saving !== null}
                    onPress={() => void pick(engine.instanceId, model.id)}
                    style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}
                  >
                    <Txt variant="callout" numberOfLines={1} style={styles.fill}>
                      {model.label}
                    </Txt>
                    {saving === key ? (
                      <ActivityIndicator size="small" color={colors.text2} />
                    ) : selected ? (
                      <Check size={size.icon} color={colors.text} strokeWidth={size.iconStroke} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
          {notSetUp.length ? (
            <Txt variant="footnote" tone="tertiary" style={styles.notSetUp}>
              Not set up on {hostName}: {notSetUp.join(", ")}.
            </Txt>
          ) : null}
        </ScrollView>
      }
    >
      <View style={styles.header}>
        <Txt variant="headline">Model</Txt>
        <Txt variant="subhead" tone="secondary">
          What {bot.name} runs on, for new turns.
        </Txt>
        {error ? (
          <Txt variant="footnote" style={styles.error}>
            {error}
          </Txt>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[2], gap: space[1] },
  error: { color: colors.danger },
  list: { paddingHorizontal: space[2], paddingBottom: space[3] },
  empty: { padding: space[4] },
  engine: { paddingTop: space[2] },
  engineName: { paddingHorizontal: space[3], paddingBottom: space[1] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: size.tap, paddingHorizontal: space[3], borderRadius: radius.md },
  selected: { backgroundColor: colors.surface1 },
  pressed: { backgroundColor: colors.surface2 },
  notSetUp: { paddingHorizontal: space[3], paddingTop: space[4] },
});
