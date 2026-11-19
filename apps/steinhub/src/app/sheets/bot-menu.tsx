import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { CheckCheck, Copy, FolderPlus, Pencil, Pin, PinOff, SquarePen, Trash2, type LucideIcon } from "lucide-react-native";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Avatar } from "@/components/avatar";
import { SheetContent } from "@/components/sheet";
import { Txt } from "@/components/text";
import { useBotCommands } from "@/state/bot-commands";
import { useConnection } from "@/state/connection";
import type { BotView } from "@/state/views";
import { useWorld } from "@/state/world";
import { colors, radius, size, space } from "@/theme";

interface Entry {
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  onPress: () => void;
}

/** The desktop sidebar's "…" menu, less what a paired phone may not do (Chief of Staff, departments, duplicate,
 * archive, working folders). */
export default function BotMenuSheet() {
  const { bot: botId } = useLocalSearchParams<{ bot: string }>();
  const world = useWorld();
  const connection = useConnection();
  const { live, failed, newThread } = useBotCommands();
  const bot = world.bot(botId);

  if (!bot) {
    return (
      <SheetContent label="Bot menu" header={null}>
        <Txt variant="subhead" tone="tertiary" style={styles.missing}>
          This bot isn&apos;t on the computer any more.
        </Txt>
      </SheetContent>
    );
  }

  function closeThen(work: () => Promise<unknown>) {
    router.back();
    if (live) void work().catch(failed);
  }

  function confirmDelete(target: BotView) {
    Alert.alert(`Delete ${target.name}?`, `${target.name} and its threads are removed from ${world.host.name}. This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => closeThen(() => connection.deleteBot(target.id)) },
    ]);
  }

  const threadId = bot.threadId;
  const groups: Entry[][] = [
    [
      {
        label: "New thread",
        icon: SquarePen,
        onPress: () =>
          void newThread(bot).then((href) => {
            if (href) router.dismissTo(href);
          }),
      },
      { label: "New folder", icon: FolderPlus, onPress: () => router.replace({ pathname: "/sheets/new-folder", params: { bot: bot.id } }) },
    ],
    [
      { label: bot.pinned ? "Unpin" : "Pin", icon: bot.pinned ? PinOff : Pin, onPress: () => closeThen(() => connection.setPinned(bot.id, !bot.pinned)) },
      ...(threadId ? [{ label: "Mark as read", icon: CheckCheck, onPress: () => closeThen(() => connection.markRead(bot.id, threadId)) }] : []),
    ],
    [
      { label: "Edit profile", icon: Pencil, onPress: () => router.dismissTo({ pathname: "/bot/[id]", params: { id: bot.id } }) },
      ...(threadId
        ? [
            {
              label: "Copy conversation ID",
              icon: Copy,
              onPress: () => {
                void Clipboard.setStringAsync(threadId);
                router.back();
              },
            },
          ]
        : []),
    ],
    [{ label: "Delete", icon: Trash2, destructive: true, onPress: () => confirmDelete(bot) }],
  ];

  return (
    <SheetContent
      label={`${bot.name} menu`}
      header={
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
      }
    >
      <View style={styles.list}>
        {groups.map((group, index) => (
          <View key={index} style={index > 0 ? styles.group : undefined}>
            {group.map(({ label, icon: Icon, destructive, onPress }) => (
              <Pressable key={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <Icon size={size.icon} color={destructive ? colors.danger : colors.text2} strokeWidth={size.iconStroke} />
                <Txt variant="callout" style={destructive ? styles.destructive : undefined}>
                  {label}
                </Txt>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    </SheetContent>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[5], paddingBottom: space[2] },
  fill: { flex: 1 },
  list: { paddingHorizontal: space[2] },
  group: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: space[1], paddingTop: space[1] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: size.tap, paddingHorizontal: space[3], borderRadius: radius.md },
  pressed: { backgroundColor: colors.surface1 },
  destructive: { color: colors.danger },
  missing: { padding: space[5] },
});
