import { ChevronRight } from "lucide-react-native";
import { Children, Fragment, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Txt } from "@/components/text";
import { colors, radius, size, space } from "@/theme";

export function SectionLabel({ children, trailing }: { children: string; trailing?: ReactNode }) {
  return (
    <View style={styles.sectionLabel}>
      <Txt variant="overline" tone="secondary">
        {children}
      </Txt>
      {trailing}
    </View>
  );
}

export function Group({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <View style={styles.group}>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? <View style={styles.divider} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** A chevron promises somewhere to go, so a row draws one only when it opens something. */
export type RowProps = {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  value?: string;
  destructive?: boolean;
} & ({ chevron?: false; onPress?: () => void } | { chevron: true; onPress: () => void });

export function Row({ title, subtitle, leading, trailing, value, chevron, destructive, onPress }: RowProps) {
  const content = (
    <>
      {leading}
      <View style={styles.rowText}>
        <Txt variant="callout" numberOfLines={1} style={destructive ? { color: colors.danger } : undefined}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="footnote" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {value ? (
        <Txt variant="callout" tone="secondary" numberOfLines={1} style={styles.value}>
          {value}
        </Txt>
      ) : null}
      {trailing}
      {chevron ? <ChevronRight size={16} color={colors.text3} strokeWidth={size.iconStroke} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    paddingTop: space[6],
    paddingBottom: space[2],
  },
  group: {
    marginHorizontal: space[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space[4] },
  row: {
    minHeight: 52,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  pressed: { backgroundColor: colors.surface2 },
  rowText: { flex: 1, minWidth: 96, gap: 2 },
  value: { flexShrink: 1, maxWidth: "55%", textAlign: "right" },
});
