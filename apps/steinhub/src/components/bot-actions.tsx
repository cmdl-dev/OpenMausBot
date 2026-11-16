import { CheckCheck, Copy, FolderPlus, Pencil, Pin, PinOff, SquarePen, Trash2, type LucideIcon } from "lucide-react-native";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { Txt } from "@/components/text";
import type { BotView } from "@/state/views";
import { colors, radius, shadowSheet, size, space } from "@/theme";

export type BotAction = "new-thread" | "new-folder" | "pin" | "mark-read" | "edit-profile" | "copy-id" | "delete";

interface Entry {
  action: BotAction;
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
}

/** The desktop sidebar's "…" menu, less what a paired phone may not do (Chief of Staff, departments, duplicate,
 * archive, working folders). */
function entries(bot: BotView): Entry[][] {
  return [
    [
      { action: "new-thread", label: "New thread", icon: SquarePen },
      { action: "new-folder", label: "New folder", icon: FolderPlus },
    ],
    [
      { action: "pin", label: bot.pinned ? "Unpin" : "Pin", icon: bot.pinned ? PinOff : Pin },
      { action: "mark-read", label: "Mark as read", icon: CheckCheck },
    ],
    [
      { action: "edit-profile", label: "Edit profile", icon: Pencil },
      { action: "copy-id", label: "Copy conversation ID", icon: Copy },
    ],
    [{ action: "delete", label: "Delete", icon: Trash2, destructive: true }],
  ];
}

export function BotActions({ bot, onAction, onClose }: { bot: BotView | null; onAction: (bot: BotView, action: BotAction) => void; onClose: () => void }) {
  return (
    <Modal visible={bot !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={styles.scrim} onPress={onClose} />
      {bot ? (
        <SafeAreaView edges={["bottom"]} style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Avatar bot={bot} label={bot.glyph} tint={bot.tint} />
            <View style={styles.fill}>
              <Txt variant="headline" numberOfLines={1}>
                {bot.name}
              </Txt>
              {bot.role ? (
                <Txt variant="subhead" tone="secondary" numberOfLines={1}>
                  {bot.role}
                </Txt>
              ) : null}
            </View>
          </View>
          {entries(bot).map((group, index) => (
            <View key={index} style={index > 0 ? styles.group : undefined}>
              {group
                .filter((entry) => (entry.action !== "copy-id" && entry.action !== "mark-read") || bot.threadId)
                .map(({ action, label, icon: Icon, destructive }) => (
                  <Pressable
                    key={action}
                    accessibilityRole="button"
                    onPress={() => {
                      onClose();
                      onAction(bot, action);
                    }}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  >
                    <Icon size={size.icon} color={destructive ? colors.danger : colors.text2} strokeWidth={size.iconStroke} />
                    <Txt variant="callout" style={destructive ? styles.destructive : undefined}>
                      {label}
                    </Txt>
                  </Pressable>
                ))}
            </View>
          ))}
        </SafeAreaView>
      ) : null}
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
  header: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3] },
  fill: { flex: 1 },
  group: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: space[1], paddingTop: space[1] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: size.tap, paddingHorizontal: space[3], borderRadius: radius.md },
  pressed: { backgroundColor: colors.surface1 },
  destructive: { color: colors.danger },
});
