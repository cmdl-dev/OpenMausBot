import type { InboxRow } from "@openmausbot/phone-protocol/inbox.ts";
import { router } from "expo-router";
import { Check, KeyRound, Lock } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { SectionLabel } from "@/components/list";
import { SampleNote } from "@/components/notice";
import { Screen } from "@/components/screen";
import { Badge } from "@/components/status";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
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
  const [segment, setSegment] = useState<Segment>("all");
  const needsYou = world.inbox.filter((row) => row.tab === "needs-you");
  const messages = world.inbox.filter((row) => row.tab !== "needs-you");
  const now = world.inboxNow;
  const segments: Array<{ key: Segment; label: string; count?: number }> = [
    { key: "all", label: "All" },
    { key: "needs-you", label: "Needs you", count: needsYou.length },
    { key: "messages", label: "Messages" },
  ];

  return (
    <Screen header={<PageTopBar leading="menu" action={{ icon: Check, label: "Mark all as read", plain: true }} />}>
      <LargeTitle>Inbox</LargeTitle>
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

function open(row: InboxRow, world: World) {
  const origin = world.source === "demo" ? row.origin : undefined;
  if (origin) router.navigate({ pathname: "/chat/[id]", params: { id: origin.threadId } });
}

function NeedsYouCard({ row, world, now }: { row: InboxRow; world: World; now: number }) {
  const bot = world.source === "demo" ? world.bot(row.from.botId) : null;
  const kind = kindOf(row);
  const glyph = bot?.glyph ?? row.from.name.slice(0, 1);

  if (row.card) {
    return (
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Avatar label={glyph} tint={bot?.tint} size="sm" />
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
        <View style={styles.cardActions}>
          <Button label="Approve" small />
          <Button label="Deny" variant="secondary" small />
          <View style={styles.fill} />
          <Button label="View draft" variant="ghost" small onPress={() => open(row, world)} />
        </View>
      </View>
    );
  }

  const Icon = kind.icon;
  return (
    <View style={[styles.card, styles.cardRow]}>
      <Avatar label={glyph} tint={bot?.tint} size="sm" />
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
      <Button label={kind.action} small onPress={() => open(row, world)} />
    </View>
  );
}

function MessageRow({ row, world, now }: { row: InboxRow; world: World; now: number }) {
  const bot = world.source === "demo" ? world.bot(row.from.botId) : null;
  const [title, ...rest] = row.text.split("\n");
  return (
    <Pressable accessibilityRole="button" onPress={() => open(row, world)} style={({ pressed }) => [styles.message, pressed && styles.pressed]}>
      <Avatar label={bot?.glyph ?? row.from.name.slice(0, 1)} tint={bot?.tint} />
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
});
