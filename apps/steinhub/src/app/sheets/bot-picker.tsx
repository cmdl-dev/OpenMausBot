import { router, useLocalSearchParams } from "expo-router";
import { Check, Settings } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { Avatar } from "@/components/avatar";
import { Row } from "@/components/list";
import { SheetContent } from "@/components/sheet";
import { Txt } from "@/components/text";
import { useWorld } from "@/state/world";
import { colors, radius, size, space } from "@/theme";

export default function BotPickerSheet() {
  const world = useWorld();
  const { selected } = useLocalSearchParams<{ selected?: string }>();
  const selectedId = selected ?? world.bots[0]?.id;

  return (
    <SheetContent
      label="Bot picker"
      header={
        <View style={styles.header}>
          <Txt variant="headline">Chat with</Txt>
          <Txt variant="footnote" tone="tertiary">
            {world.bots.length} {world.bots.length === 1 ? "bot" : "bots"}
          </Txt>
        </View>
      }
    >
      <View style={styles.list}>
        {world.bots.map((bot) => (
          <Pressable
            key={bot.id}
            accessibilityRole="button"
            accessibilityState={{ selected: bot.id === selectedId }}
            onPress={() => router.dismissTo({ pathname: "/", params: { bot: bot.id } })}
            style={({ pressed }) => [styles.bot, bot.id === selectedId && styles.botSelected, pressed && styles.pressed]}
          >
            <Avatar bot={bot} label={bot.glyph} tint={bot.tint} />
            <View style={styles.fill}>
              <Txt variant="callout" weight="600">
                {bot.name}
              </Txt>
              <Txt variant="subhead" tone="secondary">
                {bot.role}
              </Txt>
              <Txt variant="caption" tone="tertiary" weight="400">
                {bot.model}
              </Txt>
            </View>
            {bot.id === selectedId ? <Check size={size.icon} color={colors.text} strokeWidth={size.iconStroke} /> : null}
          </Pressable>
        ))}
        {selectedId ? (
          <>
            <View style={styles.divider} />
            <Row
              title="Manage bots"
              leading={<Settings size={size.icon} color={colors.text2} strokeWidth={size.iconStroke} />}
              chevron
              onPress={() => router.dismissTo({ pathname: "/bot/[id]", params: { id: selectedId } })}
            />
          </>
        ) : null}
      </View>
    </SheetContent>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: space[5], paddingBottom: space[2] },
  list: { paddingHorizontal: space[2] },
  bot: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], borderRadius: radius.md },
  botSelected: { backgroundColor: colors.surface1 },
  pressed: { backgroundColor: colors.surface2 },
  fill: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space[2], marginHorizontal: space[3] },
});
