import { router, useLocalSearchParams } from "expo-router";
import { Check } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { problemText } from "@/api/errors";
import { SheetContent } from "@/components/sheet";
import { Txt } from "@/components/text";
import { useConnection } from "@/state/connection";
import { useWorld } from "@/state/world";
import { colors, radius, size, space } from "@/theme";

/** Pick the model a bot runs on, from every engine the computer has. */
export default function ModelSheet() {
  const { bot: botId } = useLocalSearchParams<{ bot: string }>();
  const world = useWorld();
  const connection = useConnection();
  const bot = world.bot(botId);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = bot?.modelSelection;
  const engines = world.engines;
  const usable = engines
    .filter((engine) => !engine.unavailable)
    .sort((a, b) => Number(b.instanceId === current?.instanceId) - Number(a.instanceId === current?.instanceId));
  const notSetUp = engines.filter((engine) => engine.unavailable).map((engine) => engine.name);

  async function pick(instanceId: string, model: string) {
    if (!bot) return;
    if (current?.instanceId === instanceId && current.model === model) {
      router.back();
      return;
    }
    setSaving(`${instanceId}/${model}`);
    setError(null);
    try {
      await connection.setModel(bot.id, { instanceId, model });
      router.back();
    } catch (failure) {
      setError(problemText(failure, world.host.name));
    } finally {
      setSaving(null);
    }
  }

  return (
    <SheetContent
      label={bot ? `Model for ${bot.name}` : "Model"}
      header={
        <View style={styles.header}>
          <Txt variant="headline">Model</Txt>
          <Txt variant="subhead" tone="secondary">
            {bot ? `What ${bot.name} runs on, for new turns.` : "This bot isn't on the computer any more."}
          </Txt>
          {error ? (
            <Txt variant="footnote" style={styles.error}>
              {error}
            </Txt>
          ) : null}
        </View>
      }
    >
      <View style={styles.list}>
        {bot && engines.length === 0 ? (
          <Txt variant="subhead" tone="tertiary" style={styles.note}>
            Loading the computer&apos;s engines…
          </Txt>
        ) : null}
        {bot
          ? usable.map((engine) => (
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
            ))
          : null}
        {bot && notSetUp.length ? (
          <Txt variant="footnote" tone="tertiary" style={styles.note}>
            Not set up on {world.host.name}: {notSetUp.join(", ")}.
          </Txt>
        ) : null}
      </View>
    </SheetContent>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingHorizontal: space[5], paddingBottom: space[2], gap: space[1] },
  error: { color: colors.danger },
  list: { paddingHorizontal: space[2] },
  note: { paddingHorizontal: space[3], paddingTop: space[3] },
  engine: { paddingTop: space[2] },
  engineName: { paddingHorizontal: space[3], paddingBottom: space[1] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: size.tap, paddingHorizontal: space[3], borderRadius: radius.md },
  selected: { backgroundColor: colors.surface1 },
  pressed: { backgroundColor: colors.surface2 },
});
