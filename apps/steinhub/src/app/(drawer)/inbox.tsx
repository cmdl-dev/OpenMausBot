import type { InboxRow } from "@openmausbot/phone-protocol/inbox.ts";
import { router, useFocusEffect } from "expo-router";
import { Check, KeyRound, Lock } from "lucide-react-native";
import { useCallback, useState } from "react";
import { problemText } from "@/api/errors";
import { Pressable, StyleSheet, View } from "react-native";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { SectionLabel } from "@/components/list";
import { SampleNote } from "@/components/notice";
import { Screen } from "@/components/screen";
import { Badge } from "@/components/status";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { useConnection } from "@/state/connection";
import { shortWhen } from "@/state/views";
import { useWorld, type World } from "@/state/world";
import { colors, radius, size, space } from "@/theme";

type Segment = "all" | "needs-you" | "messages";

function ago(at: number, now: number): string {
  const minutes = Math.max(1, Math.round((now - at) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

function kindOf(row: InboxRow): { label: string; tone?: "warning"; icon?: typeof KeyRound; action: string } {
  if (row.secret) return { label: "Secret", icon: KeyRound, action: "Provide" };
  if (row.signIn) return { label: "Sign-in", icon: Lock, action: "Sign in" };
  if (row.card) return { label: "Approval", tone: "warning", action: "Approve" };
  return { label: row.kind === "notice" ? "Notice" : "Question", action: "Open" };
}

export default function InboxScreen() {
  const world = useWorld();
  const { refreshInbox, markInboxRead } = useConnection();
  const [segment, setSegment] = useState<Segment>("all");
  const [error, setError] = useState<string | null>(null);
  const live = world.source === "live" && !world.inboxIsSample;
  useFocusEffect(
    useCallback(() => {
      void refreshInbox();
    }, [refreshInbox]),
  );

  async function markAll() {
    setError(null);
    try {
      await markInboxRead();
    } catch (failure) {
      setError(problemText(failure, world.host.name));
    }
  }
  const needsYou = world.inbox.filter((row) => row.tab === "needs-you");
  const messages = world.inbox.filter((row) => row.tab !== "needs-you");
  const now = world.inboxNow;
  const segments: Array<{ key: Segment; label: string; count?: number }> = [
    { key: "all", label: "All" },
    { key: "needs-you", label: "Needs you", count: needsYou.length },
    { key: "messages", label: "Messages" },
  ];

  return (
    <Screen
      header={
        <PageTopBar
          leading="menu"
          action={live && world.inbox.some((row) => row.unread) ? { icon: Check, label: "Mark all as read", plain: true, onPress: () => void markAll() } : undefined}
        />
      }
    >
      <LargeTitle>Inbox</LargeTitle>
      {error ? (
        <Txt variant="footnote" style={styles.error}>
          {error}
        </Txt>
      ) : null}
      {world.inboxIsSample ? (
        <SampleNote>{`Sample data. ${world.host.name} doesn't share its inbox with phones yet; approvals still appear in each chat.`}</SampleNote>
      ) : null}
      <View style={styles.segments}>
        {segments.map((option) => (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: option.key === segment }}
            onPress={() => setSegment(option.key)}
            style={[styles.segment, option.key === segment && styles.segmentSelected]}
          >
            <Txt variant="subhead" weight="500" tone={option.key === segment ? "primary" : "secondary"}>
              {option.label}
            </Txt>
            {option.count ? (
              <Txt variant="footnote" tone="tertiary">
                {option.count}
              </Txt>
            ) : null}
          </Pressable>
        ))}
      </View>

      {segment !== "messages" && needsYou.length ? (
        <>
          <SectionLabel>Needs you</SectionLabel>
          <View style={styles.cards}>
            {needsYou.map((row) => (
              <NeedsYouCard key={row.id} row={row} world={world} now={now} />
            ))}
          </View>
        </>
      ) : null}

      {segment !== "needs-you" && messages.length ? (
        <>
          <SectionLabel>Messages</SectionLabel>
          {messages.map((row) => (
            <MessageRow key={row.id} row={row} world={world} now={now} />
          ))}
        </>
      ) : null}

      {(segment === "needs-you" && !needsYou.length) || (segment === "messages" && !messages.length) || !world.inbox.length ? (
        <Txt variant="subhead" tone="tertiary" style={styles.empty}>
          Nothing here.
        </Txt>
      ) : null}
    </Screen>
  );
}

/** The conversation a row came from, unless the rows are the sample's, whose conversations aren't on the computer. */
function originOf(row: InboxRow, world: World): string | null {
  return world.inboxIsSample ? null : (row.origin?.threadId ?? null);
}

function open(threadId: string) {
  router.navigate({ pathname: "/chat/[id]", params: { id: threadId } });
}

function ApprovalActions({ row, threadId, world }: { row: InboxRow; threadId: string | null; world: World }) {
  const { respond } = useConnection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = row.card;
  const permission = Boolean(card?.tool || card?.requestType === "permission");
  const requestId = world.source === "live" ? card?.requestId : undefined;

  async function answer(behavior: "allow" | "deny") {
    if (!threadId || !requestId) return;
    setBusy(true);
    setError(null);
    try {
      await respond(threadId, requestId, { behavior });
    } catch (failure) {
      setError(problemText(failure, world.host.name));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <View style={styles.cardActions}>
        {permission && threadId && requestId ? (
          <>
            <Button label="Approve" small disabled={busy} onPress={() => void answer("allow")} />
            <Button label="Deny" variant="secondary" small disabled={busy} onPress={() => void answer("deny")} />
          </>
        ) : null}
        <View style={styles.fill} />
        {threadId ? <Button label={permission ? "Open chat" : "Answer"} variant="ghost" small onPress={() => open(threadId)} /> : null}
      </View>
      {error ? (
        <Txt variant="footnote" style={styles.cardError}>
          {error}
        </Txt>
      ) : null}
    </>
  );
}

function NeedsYouCard({ row, world, now }: { row: InboxRow; world: World; now: number }) {
  const bot = world.bot(row.from.botId);
  const kind = kindOf(row);
  const glyph = bot?.glyph ?? row.from.name.slice(0, 1);
  const threadId = originOf(row, world);

  if (row.card) {
    return (
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Avatar bot={bot} label={glyph} tint={bot?.tint} size="sm" />
          <Txt variant="subhead" weight="600">
            {row.from.name}
          </Txt>
          <Badge label={kind.label} tone={kind.tone} />
          <View style={styles.fill} />
          <Txt variant="footnote" tone="tertiary">
            {ago(row.at, now)}
          </Txt>
        </View>
        <Txt variant="headline">{row.card.title}</Txt>
        {row.card.subtitle ? (
          <Txt variant="subhead" tone="secondary">
            {row.card.subtitle}
          </Txt>
        ) : null}
        <ApprovalActions row={row} threadId={threadId} world={world} />
      </View>
    );
  }

  const Icon = kind.icon;
  return (
    <View style={[styles.card, styles.cardRow]}>
      <Avatar bot={bot} label={glyph} tint={bot?.tint} size="sm" />
      <View style={styles.fill}>
        <View style={styles.kindLine}>
          <Txt variant="footnote" weight="600">
            {row.from.name}
          </Txt>
          {Icon ? <Icon size={12} color={colors.text3} strokeWidth={size.iconStroke} /> : null}
          <Txt variant="footnote" tone="tertiary">
            {kind.label}
          </Txt>
        </View>
        <Txt variant="callout" weight="600" numberOfLines={2}>
          {row.text}
        </Txt>
      </View>
      {threadId ? <Button label={kind.action} small onPress={() => open(threadId)} /> : null}
    </View>
  );
}

function MessageRow({ row, world, now }: { row: InboxRow; world: World; now: number }) {
  const bot = world.bot(row.from.botId);
  const [title, ...rest] = row.text.split("\n");
  const threadId = originOf(row, world);
  return (
    <Pressable
      accessibilityRole={threadId ? "button" : undefined}
      disabled={!threadId}
      onPress={threadId ? () => open(threadId) : undefined}
      style={({ pressed }) => [styles.message, pressed && styles.pressed]}
    >
      <Avatar bot={bot} label={bot?.glyph ?? row.from.name.slice(0, 1)} tint={bot?.tint} />
      <View style={styles.fill}>
        <View style={styles.kindLine}>
          <Txt variant="subhead" tone="secondary" style={styles.fill}>
            {row.from.name}
          </Txt>
          <Txt variant="footnote" tone="tertiary">
            {shortWhen(row.at, now)}
          </Txt>
          {row.unread ? <View style={styles.unread} /> : null}
        </View>
        <Txt variant="callout" weight="600" numberOfLines={1}>
          {title}
        </Txt>
        {rest.length ? (
          <Txt variant="subhead" tone="secondary" numberOfLines={2}>
            {rest.join(" ")}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  segments: {
    flexDirection: "row",
    marginHorizontal: space[4],
    padding: 3,
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: { flex: 1, height: 34, borderRadius: radius.sm, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  segmentSelected: { backgroundColor: colors.surface3 },
  cards: { gap: space[2], paddingHorizontal: space[4] },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space[4],
    gap: space[2],
  },
  cardRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[3] },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space[2] },
  cardActions: { flexDirection: "row", alignItems: "center", gap: space[2], marginTop: space[2] },
  kindLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  message: { flexDirection: "row", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3] },
  pressed: { backgroundColor: colors.surface1 },
  unread: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.info },
  empty: { textAlign: "center", marginTop: space[10] },
  error: { color: colors.danger, paddingHorizontal: space[4], paddingBottom: space[2] },
  cardError: { color: colors.danger },
});
