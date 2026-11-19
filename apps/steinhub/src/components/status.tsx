import { StyleSheet, View } from "react-native";
import { Txt } from "@/components/text";
import { colors, radius, space, statusColors, type Status } from "@/theme";

export function StatusDot({ tone }: { tone?: Status }) {
  return <View style={[styles.dot, { backgroundColor: tone ? statusColors[tone].fg : colors.text3 }]} />;
}

export function Badge({ label, tone }: { label: string; tone?: Status }) {
  const palette = tone ? statusColors[tone] : { fg: colors.text2, bg: colors.surface2 };
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Txt variant="caption" style={{ color: palette.fg }}>
        {label}
      </Txt>
    </View>
  );
}

export function CountBadge({ count }: { count: number }) {
  return (
    <View style={styles.count}>
      <Txt variant="caption" tone="inverse" weight="600" style={styles.countText}>
        {count}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
  badge: {
    height: 22,
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  count: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { fontSize: 11, lineHeight: 14 },
});
