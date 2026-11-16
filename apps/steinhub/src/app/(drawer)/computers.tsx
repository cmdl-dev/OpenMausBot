import { Laptop, Monitor, Network, Plus, Server, type LucideIcon } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { SampleNote } from "@/components/notice";
import { Screen } from "@/components/screen";
import { StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import type { ComputerView } from "@/state/views";
import { useWorld, type World } from "@/state/world";
import { colors, radius, size, space } from "@/theme";

const KIND_ICONS: Record<ComputerView["kind"], LucideIcon> = { desktop: Monitor, laptop: Laptop, server: Server };
const MAX_AVATARS = 3;

export default function ComputersScreen() {
  const world = useWorld();
  return (
    <Screen
      header={
        <View style={styles.bar}>
          <PageTopBar leading="menu" />
          <View style={styles.add}>
            <Button label="Add" icon={Plus} variant="secondary" small />
          </View>
        </View>
      }
    >
      <LargeTitle>Computers</LargeTitle>
      <View style={styles.cards}>
        {world.computers.map((computer) => (
          <ComputerCard key={computer.id} computer={computer} world={world} />
        ))}
      </View>
      {world.computersPartial ? (
        <View style={styles.partial}>
          <SampleNote>{`Only ${world.host.name} is shown. It doesn't share its other computers with phones yet.`}</SampleNote>
        </View>
      ) : null}
      <Txt variant="footnote" tone="tertiary" style={styles.note}>
        Bots run tasks on these computers. The desktop host runs OpenMausBot and relays to the others.
      </Txt>
    </Screen>
  );
}

function ComputerCard({ computer, world }: { computer: ComputerView; world: World }) {
  const Icon = KIND_ICONS[computer.kind];
  const bots = computer.botIds.map((botId) => world.bot(botId)).filter((bot) => bot !== null);
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.tile}>
          <Icon size={size.icon} color={colors.text} strokeWidth={size.iconStroke} />
        </View>
        <View style={styles.fill}>
          <Txt variant="headline" numberOfLines={1}>
            {computer.name}
          </Txt>
          <Txt variant="footnote" tone="secondary" numberOfLines={1}>
            {computer.os}
          </Txt>
          <View style={styles.status}>
            <StatusDot tone={computer.state.tone} />
            <Txt variant="footnote">{computer.state.label}</Txt>
            {computer.note ? (
              <Txt variant="footnote" tone="tertiary">
                · {computer.note}
              </Txt>
            ) : null}
          </View>
        </View>
        <View style={styles.avatars}>
          {bots.slice(0, MAX_AVATARS).map((bot, index) => (
            <View key={bot.id} style={[styles.stacked, index > 0 && styles.overlap]}>
              <Avatar label={bot.glyph} tint={bot.tint} size="xs" />
            </View>
          ))}
          {bots.length > MAX_AVATARS ? (
            <Txt variant="caption" tone="tertiary" style={styles.more}>
              +{bots.length - MAX_AVATARS}
            </Txt>
          ) : null}
        </View>
      </View>
      {computer.isHost ? (
        <View style={styles.tag}>
          <Network size={12} color={colors.text2} strokeWidth={size.iconStroke} />
          <Txt variant="caption" weight="400" tone="secondary">
            Desktop host
          </Txt>
        </View>
      ) : null}
      {computer.metrics ? (
        <View style={styles.metrics}>
          <Meter label="CPU" value={computer.metrics.cpu} />
          <Meter label="Mem" value={computer.metrics.mem} />
          <Meter label="Disk" value={computer.metrics.disk} />
        </View>
      ) : null}
    </View>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.meter} accessible accessibilityLabel={`${label} ${value}%`}>
      <View style={styles.meterHead}>
        <Txt variant="caption" weight="400" tone="tertiary">
          {label}
        </Txt>
        <Txt variant="caption">{value}%</Txt>
      </View>
      <View style={styles.track}>
        <View style={[styles.fillBar, { width: `${Math.min(100, Math.max(0, value))}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { position: "relative" },
  add: { position: "absolute", right: space[4], top: 0, bottom: 0, justifyContent: "center" },
  cards: { gap: space[3], paddingHorizontal: space[4] },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space[4],
    gap: space[3],
  },
  top: { flexDirection: "row", gap: space[3] },
  tile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  status: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: space[1] },
  avatars: { flexDirection: "row", alignItems: "center" },
  stacked: { borderRadius: 12, borderWidth: 2, borderColor: colors.surface1 },
  overlap: { marginLeft: -6 },
  more: { marginLeft: space[1] },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    height: 24,
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
  },
  metrics: {
    flexDirection: "row",
    gap: space[4],
    paddingTop: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  meter: { flex: 1, gap: 6 },
  meterHead: { flexDirection: "row", justifyContent: "space-between" },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.surface3, overflow: "hidden" },
  fillBar: { height: 3, borderRadius: 2, backgroundColor: colors.text },
  partial: { paddingTop: space[3] },
  note: { paddingHorizontal: space[5], paddingTop: space[3] },
});
