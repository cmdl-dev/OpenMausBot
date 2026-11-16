import { router, useNavigation } from "expo-router";
import type { DrawerNavigationProp } from "expo-router/drawer";
import { Bell, ChevronDown, ChevronLeft, SquarePen, TextAlignStart, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { IconButton } from "@/components/icon-button";
import { Txt } from "@/components/text";
import { colors, size, space } from "@/theme";

type DrawerNavigation = DrawerNavigationProp<Record<string, object | undefined>>;

export function useOpenDrawer(): () => void {
  const navigation = useNavigation<DrawerNavigation>();
  return () => navigation.openDrawer();
}

export interface ChatTopBarProps {
  botName: string;
  subtitle?: string;
  right: "inbox" | "new-chat";
  unread?: boolean;
  onPressTitle?: () => void;
}

export function ChatTopBar({ botName, subtitle, right, unread, onPressTitle }: ChatTopBarProps) {
  const openDrawer = useOpenDrawer();
  return (
    <View style={styles.bar}>
      <IconButton icon={TextAlignStart} label="Open drawer" onPress={openDrawer} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Switch bot, ${botName}`} onPress={onPressTitle} style={styles.center}>
        <View style={styles.titleRow}>
          <Txt variant="headline">{botName}</Txt>
          <ChevronDown size={16} color={colors.text3} strokeWidth={size.iconStroke} />
        </View>
        {subtitle ? (
          <Txt variant="caption" tone="tertiary" numberOfLines={1} weight="400">
            {subtitle}
          </Txt>
        ) : null}
      </Pressable>
      {right === "inbox" ? (
        <IconButton icon={Bell} label={unread ? "Inbox, unread items" : "Inbox"} dot={unread} onPress={() => router.navigate("/inbox")} />
      ) : (
        <IconButton icon={SquarePen} label="New chat" onPress={() => router.navigate("/")} />
      )}
    </View>
  );
}

export interface PageTopBarProps {
  leading: "menu" | "back";
  title?: string;
  action?: { icon: LucideIcon; label: string; onPress?: () => void };
}

export function PageTopBar({ leading, title, action }: PageTopBarProps) {
  const openDrawer = useOpenDrawer();
  return (
    <View style={styles.bar}>
      {leading === "menu" ? (
        <IconButton icon={TextAlignStart} label="Open drawer" onPress={openDrawer} />
      ) : (
        <IconButton icon={ChevronLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))} />
      )}
      <View style={styles.center}>{title ? <Txt variant="headline">{title}</Txt> : null}</View>
      {action ? <IconButton icon={action.icon} label={action.label} onPress={action.onPress} filled /> : <View style={styles.spacer} />}
    </View>
  );
}

export function LargeTitle({ children }: { children: ReactNode }) {
  return (
    <Txt variant="display" style={styles.largeTitle}>
      {children}
    </Txt>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: size.topbar,
    paddingHorizontal: space[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  spacer: { width: size.tap },
  largeTitle: { paddingHorizontal: space[4], paddingTop: space[1], paddingBottom: space[3] },
});
