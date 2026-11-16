import { router, type Href } from "expo-router";
import type { DrawerContentComponentProps } from "expo-router/drawer";
import { Inbox, Monitor, Search, Settings, Zap, type LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { IconButton } from "@/components/icon-button";
import { SectionLabel } from "@/components/list";
import { CountBadge, StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { bots, botById, inbox, threads, user, type SampleThread } from "@/sample/world";
import { colors, radius, size, space, type } from "@/theme";

const RECENT_GROUPS: SampleThread["group"][] = ["Today", "Yesterday", "Earlier"];

export function AppDrawer({ navigation }: DrawerContentComponentProps) {
  const [botFilter, setBotFilter] = useState<string | null>(null);
  const needsYou = inbox.filter((row) => row.tab === "needs-you").length;
  const visibleThreads = botFilter ? threads.filter((thread) => thread.botId === botFilter) : threads;

  function go(href: Href) {
    navigation.closeDrawer();
    router.navigate(href);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.search}>
        <Search size={18} color={colors.text3} strokeWidth={size.iconStroke} />
        <TextInput
          accessibilityLabel="Search chats"
          placeholder="Search chats"
          placeholderTextColor={colors.text3}
          selectionColor={colors.text}
          style={styles.searchInput}
        />
      </View>

      <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
        <NavItem icon={Inbox} label="Inbox" count={needsYou} onPress={() => go("/inbox")} />
        <NavItem icon={Zap} label="Automations" onPress={() => go("/automations")} />
        <NavItem icon={Monitor} label="Computers" onPress={() => go("/computers")} />

        <SectionLabel>Bots</SectionLabel>
        {bots.map((bot) => (
          <Pressable
            key={bot.id}
            accessibilityRole="button"
            accessibilityState={{ selected: botFilter === bot.id }}
            onPress={() => setBotFilter((current) => (current === bot.id ? null : bot.id))}
            onLongPress={() => go({ pathname: "/bot/[id]", params: { id: bot.id } })}
            style={[styles.item, botFilter === bot.id && styles.itemSelected]}
          >
            <Avatar label={bot.name} tint={bot.tint} size="sm" />
            <Txt variant="callout" style={styles.fill}>
              {bot.name}
            </Txt>
            <StatusDot tone={bot.state.tone} />
            <Txt variant="footnote" tone="secondary">
              {bot.state.label}
            </Txt>
          </Pressable>
        ))}

        <SectionLabel>Recent</SectionLabel>
        {RECENT_GROUPS.map((group) => {
          const inGroup = visibleThreads.filter((thread) => thread.group === group);
          if (inGroup.length === 0) return null;
          return (
            <View key={group}>
              <Txt variant="footnote" tone="tertiary" style={styles.groupLabel}>
                {group}
              </Txt>
              {inGroup.map((thread) => (
                <Pressable
                  key={thread.id}
                  accessibilityRole="button"
                  onPress={() => go({ pathname: "/chat/[id]", params: { id: thread.id } })}
                  style={({ pressed }) => [styles.thread, pressed && styles.itemSelected]}
                >
                  <Avatar label={botById(thread.botId).name} tint={botById(thread.botId).tint} size="sm" />
                  <Txt variant="callout" numberOfLines={1} style={styles.fill}>
                    {thread.title}
                  </Txt>
                </Pressable>
              ))}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Avatar label={user.initials} size="md" />
        <View style={styles.fill}>
          <Txt variant="callout" weight="600">
            {user.name}
          </Txt>
          <Txt variant="footnote" tone="secondary">
            {user.email}
          </Txt>
        </View>
        <IconButton icon={Settings} label="Settings" onPress={() => go("/settings")} />
      </View>
    </SafeAreaView>
  );
}

function NavItem({ icon: Icon, label, count, onPress }: { icon: LucideIcon; label: string; count?: number; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.item, pressed && styles.itemSelected]}>
      <Icon size={size.icon} color={colors.text} strokeWidth={size.iconStroke} />
      <Txt variant="callout" style={styles.fill}>
        {label}
      </Txt>
      {count ? <CountBadge count={count} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgRaised },
  fill: { flex: 1 },
  content: { paddingBottom: space[6] },
  search: {
    marginHorizontal: space[3],
    marginTop: space[2],
    marginBottom: space[3],
    height: 40,
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  searchInput: { ...type.callout, flex: 1, color: colors.text, paddingVertical: 0 },
  item: {
    minHeight: size.tap,
    marginHorizontal: space[2],
    paddingHorizontal: space[2],
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  itemSelected: { backgroundColor: colors.surface2 },
  groupLabel: { paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[1] },
  thread: {
    minHeight: 40,
    marginHorizontal: space[2],
    paddingHorizontal: space[2],
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
