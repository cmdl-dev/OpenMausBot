import * as Clipboard from "expo-clipboard";
import { router, type Href } from "expo-router";
import type { DrawerContentComponentProps } from "expo-router/drawer";
import {
  Blocks,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  FolderPlus,
  Inbox,
  Monitor,
  Plus,
  Search,
  Settings,
  Zap,
  type LucideIcon,
} from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { problemText } from "@/api/errors";
import { Avatar } from "@/components/avatar";
import { BotActions, type BotAction } from "@/components/bot-actions";
import { FolderSheet } from "@/components/folder-sheet";
import { IconButton } from "@/components/icon-button";
import { CountBadge, StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { useConnection } from "@/state/connection";
import { ago, initials, type BotSection, type BotView, type FolderView, type ThreadView } from "@/state/views";
import { useWorld } from "@/state/world";
import { colors, radius, size, space, type } from "@/theme";

const THREADS_SHOWN = 8;

export function AppDrawer({ navigation }: DrawerContentComponentProps) {
  const world = useWorld();
  const connection = useConnection();
  const { session } = connection;
  const live = world.source === "live";
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [actionsFor, setActionsFor] = useState<BotView | null>(null);
  const [folderFor, setFolderFor] = useState<BotView | null>(null);
  const needsYou = world.inboxIsSample ? 0 : world.inbox.filter((row) => row.tab === "needs-you").length;
  const footer = world.person ?? {
    name: world.host.name,
    email: session ? `This phone: ${session.device.name}` : "",
    initials: initials(world.host.name),
  };

  function go(href: Href) {
    navigation.closeDrawer();
    router.navigate(href);
  }

  const threadsOf = (bot: BotView) => world.threads.filter((thread) => thread.botId === bot.id);

  function openBot(bot: BotView) {
    const latest = threadsOf(bot)[0]?.id ?? bot.threadId;
    if (latest) go({ pathname: "/chat/[id]", params: { id: latest } });
    else go({ pathname: "/", params: { bot: bot.id } });
  }

  function failed(error: unknown) {
    Alert.alert("That didn't work", problemText(error, world.host.name));
  }

  async function newThread(bot: BotView, folderId?: string) {
    if (!live) {
      go({ pathname: "/", params: { bot: bot.id } });
      return;
    }
    try {
      const threadId = await connection.newThread(bot.id, folderId);
      go({ pathname: "/chat/[id]", params: { id: threadId } });
    } catch (error) {
      failed(error);
    }
  }

  function confirmDelete(bot: BotView) {
    Alert.alert(`Delete ${bot.name}?`, `${bot.name} and its threads are removed from ${world.host.name}. This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void connection.deleteBot(bot.id).catch(failed) },
    ]);
  }

  function act(bot: BotView, action: BotAction) {
    if (action === "new-thread") void newThread(bot);
    else if (action === "new-folder") setFolderFor(bot);
    else if (action === "edit-profile") go({ pathname: "/bot/[id]", params: { id: bot.id } });
    else if (action === "copy-id" && bot.threadId) void Clipboard.setStringAsync(bot.threadId);
    else if (!live) return;
    else if (action === "pin") void connection.setPinned(bot.id, !bot.pinned).catch(failed);
    else if (action === "mark-read" && bot.threadId) void connection.markRead(bot.id, bot.threadId).catch(failed);
    else if (action === "delete") confirmDelete(bot);
  }

  function flip(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
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

        {world.sections.map((section: BotSection) => {
          const folded = collapsed.has(section.name);
          const Chevron = folded ? ChevronRight : ChevronDown;
          return (
            <View key={section.name}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={section.name}
                accessibilityState={{ expanded: !folded }}
                onPress={() => setCollapsed((current) => flip(current, section.name))}
                style={styles.sectionHeader}
              >
                <Txt variant="overline" tone="secondary" style={styles.fill}>
                  {section.name}
                </Txt>
                <Chevron size={14} color={colors.text3} strokeWidth={size.iconStroke} />
              </Pressable>
              {folded
                ? null
                : section.bots.map((bot) => (
                    <BotRow
                      key={bot.id}
                      bot={bot}
                      threads={threadsOf(bot)}
                      open={expanded.has(bot.id)}
                      onToggle={() => setExpanded((current) => flip(current, bot.id))}
                      onOpen={() => openBot(bot)}
                      onOpenThread={(threadId) => go({ pathname: "/chat/[id]", params: { id: threadId } })}
                      onNewThread={(folderId) => void newThread(bot, folderId)}
                      onNewFolder={() => setFolderFor(bot)}
                      onMore={() => setActionsFor(bot)}
                    />
                  ))}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.bottomNav}>
        <NavItem icon={Zap} label="Automations" onPress={() => go("/automations")} />
        <NavItem icon={Monitor} label="Computers" onPress={() => go("/computers")} />
        <NavItem icon={Blocks} label="Apps" onPress={() => go("/apps")} />
      </View>

      <View style={styles.footer}>
        <Avatar label={footer.initials} size="md" />
        <View style={styles.fill}>
          <Txt variant="callout" weight="600" numberOfLines={1}>
            {footer.name}
          </Txt>
          <Txt variant="footnote" tone="secondary" numberOfLines={1}>
            {footer.email}
          </Txt>
        </View>
        <IconButton icon={Settings} label="Settings" onPress={() => go("/settings")} />
      </View>

      <BotActions bot={actionsFor} onAction={act} onClose={() => setActionsFor(null)} />
      <FolderSheet
        botName={folderFor?.name ?? ""}
        visible={folderFor !== null}
        onClose={() => setFolderFor(null)}
        onCreate={async (folder) => {
          if (!folderFor || !live) return;
          try {
            await connection.newFolder(folderFor.id, folder);
          } catch (error) {
            throw new Error(problemText(error, world.host.name));
          }
        }}
      />
    </SafeAreaView>
  );
}

function BotRow({
  bot,
  threads,
  open,
  onToggle,
  onOpen,
  onOpenThread,
  onNewThread,
  onNewFolder,
  onMore,
}: {
  bot: BotView;
  threads: ThreadView[];
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onOpenThread: (threadId: string) => void;
  onNewThread: (folderId?: string) => void;
  onNewFolder: () => void;
  onMore: () => void;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  const folders = bot.folders ?? [];
  const loose = threads.filter((thread) => !thread.folderId || !folders.some((folder) => folder.id === thread.folderId));
  return (
    <View>
      <View style={styles.botRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? `Hide ${bot.name}'s threads` : `Show ${bot.name}'s threads`}
          accessibilityState={{ expanded: open }}
          hitSlop={6}
          onPress={onToggle}
          style={styles.chevron}
        >
          <Chevron size={14} color={colors.text3} strokeWidth={size.iconStroke} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${bot.name}, ${bot.state.label}`}
          accessibilityHint="Opens its latest thread. Long press for more."
          onPress={onOpen}
          onLongPress={onMore}
          style={({ pressed }) => [styles.botMain, pressed && styles.pressed]}
        >
          <Avatar bot={bot} label={bot.glyph} tint={bot.tint} size="sm" />
          <View style={styles.fill}>
            <View style={styles.nameLine}>
              <Txt variant="callout" weight="600" numberOfLines={1} style={styles.shrink}>
                {bot.name}
              </Txt>
              <StatusDot tone={bot.state.tone} />
            </View>
            {bot.role ? (
              <Txt variant="caption" weight="400" tone="tertiary" numberOfLines={1}>
                {bot.role}
              </Txt>
            ) : null}
          </View>
        </Pressable>
        <RowButton icon={Plus} label={`New thread with ${bot.name}`} onPress={() => onNewThread()} />
        <RowButton icon={FolderPlus} label={`New folder for ${bot.name}`} onPress={onNewFolder} />
        <RowButton icon={Ellipsis} label={`More for ${bot.name}`} onPress={onMore} />
      </View>
      {open ? (
        <View style={styles.threads}>
          {folders.map((folder) => (
            <FolderBlock
              key={folder.id}
              folder={folder}
              threads={threads.filter((thread) => thread.folderId === folder.id)}
              onOpenThread={onOpenThread}
              onNewThread={() => onNewThread(folder.id)}
            />
          ))}
          {loose.slice(0, THREADS_SHOWN).map((thread) => (
            <ThreadRow key={thread.id} thread={thread} onPress={() => onOpenThread(thread.id)} />
          ))}
          {threads.length === 0 ? (
            <Txt variant="footnote" tone="tertiary" style={styles.noThreads}>
              No threads yet.
            </Txt>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function FolderBlock({
  folder,
  threads,
  onOpenThread,
  onNewThread,
}: {
  folder: FolderView;
  threads: ThreadView[];
  onOpenThread: (threadId: string) => void;
  onNewThread: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <View style={styles.folderRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={styles.folderMain}
        >
          {folder.emoji ? <Txt variant="callout">{folder.emoji}</Txt> : <Folder size={16} color={colors.text2} strokeWidth={size.iconStroke} />}
          <Txt variant="subhead" numberOfLines={1} style={styles.fill}>
            {folder.name}
          </Txt>
          <Txt variant="caption" weight="400" tone="tertiary">
            {threads.length}
          </Txt>
        </Pressable>
        <RowButton icon={Plus} label={`New thread in ${folder.name}`} onPress={onNewThread} />
      </View>
      {open ? (
        <View style={styles.folderThreads}>
          {threads.map((thread) => (
            <ThreadRow key={thread.id} thread={thread} onPress={() => onOpenThread(thread.id)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ThreadRow({ thread, onPress }: { thread: ThreadView; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.thread, pressed && styles.pressed]}>
      <Txt variant="subhead" weight={thread.unread ? "600" : "400"} numberOfLines={1} style={styles.threadTitle}>
        {thread.title}
      </Txt>
      {thread.openedBy ? (
        <Txt variant="caption" weight="400" tone="tertiary" numberOfLines={1} style={styles.openedBy}>
          opened by {thread.openedBy}
        </Txt>
      ) : null}
      {thread.at ? (
        <Txt variant="caption" weight="400" tone="tertiary">
          {ago(thread.at)}
        </Txt>
      ) : null}
    </Pressable>
  );
}

function RowButton({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={4} onPress={onPress} style={({ pressed }) => [styles.rowButton, pressed && styles.pressed]}>
      <Icon size={17} color={colors.text2} strokeWidth={size.iconStroke} />
    </Pressable>
  );
}

function NavItem({ icon: Icon, label, count, onPress }: { icon: LucideIcon; label: string; count?: number; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
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
  shrink: { flexShrink: 1 },
  content: { paddingBottom: space[4] },
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
  sectionHeader: { flexDirection: "row", alignItems: "center", minHeight: size.tap, paddingHorizontal: space[4], paddingTop: space[3] },
  item: {
    minHeight: size.tap,
    marginHorizontal: space[2],
    paddingHorizontal: space[2],
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  pressed: { backgroundColor: colors.surface2 },
  botRow: { flexDirection: "row", alignItems: "center", marginHorizontal: space[1], minHeight: 52 },
  chevron: { width: 22, height: size.tap, alignItems: "center", justifyContent: "center" },
  botMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: space[1], paddingHorizontal: space[1], borderRadius: radius.md },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowButton: { width: 32, height: 36, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  threads: { marginLeft: space[8], marginRight: space[2], marginBottom: space[2] },
  folderRow: { flexDirection: "row", alignItems: "center" },
  folderMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 36, paddingHorizontal: space[2] },
  folderThreads: { marginLeft: space[4] },
  thread: { flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 36, paddingHorizontal: space[2], borderRadius: radius.sm },
  threadTitle: { flexShrink: 1 },
  openedBy: { flexShrink: 1, maxWidth: "40%" },
  noThreads: { paddingHorizontal: space[2], paddingVertical: space[2] },
  bottomNav: { paddingVertical: space[1], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
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
