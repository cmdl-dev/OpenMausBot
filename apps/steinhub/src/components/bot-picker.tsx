import { router } from "expo-router";
import { Check, Settings } from "lucide-react-native";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { Row } from "@/components/list";
import { Txt } from "@/components/text";
import { bots } from "@/sample/world";
import { colors, radius, shadowSheet, size, space } from "@/theme";

export interface BotPickerProps {
  visible: boolean;
  selectedId: string;
  onSelect: (botId: string) => void;
  onClose: () => void;
}

export function BotPicker({ visible, selectedId, onSelect, onClose }: BotPickerProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close bot picker" style={styles.scrim} onPress={onClose} />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Txt variant="headline">Chat with</Txt>
          <Txt variant="footnote" tone="tertiary">
            {bots.length} bots
          </Txt>
        </View>
        {bots.map((bot) => (
          <Pressable
            key={bot.id}
            accessibilityRole="button"
            accessibilityState={{ selected: bot.id === selectedId }}
            onPress={() => {
              onSelect(bot.id);
              onClose();
            }}
            style={[styles.bot, bot.id === selectedId && styles.botSelected]}
          >
            <Avatar label={bot.name} tint={bot.tint} />
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
        <View style={styles.divider} />
        <Row
          title="Manage bots"
          leading={<Settings size={size.icon} color={colors.text2} strokeWidth={size.iconStroke} />}
          chevron
          onPress={() => {
            onClose();
            router.navigate({ pathname: "/bot/[id]", params: { id: selectedId } });
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.bgRaised,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space[2],
    paddingBottom: space[2],
    ...shadowSheet,
  },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.surface3, marginTop: space[2] },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", padding: space[3] },
  bot: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], borderRadius: radius.md },
  botSelected: { backgroundColor: colors.surface1 },
  fill: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space[2], marginHorizontal: space[3] },
});
