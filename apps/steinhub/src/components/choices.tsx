import { Check } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Txt } from "@/components/text";
import { colors, radius, size, space } from "@/theme";

/** A sheet's list of options, the chosen one checked. */
export function Choice({ label, detail, selected, onPress, children }: { label: string; detail?: string; selected: boolean; onPress: () => void; children?: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.fill}>
        {children ?? <Txt variant="callout">{label}</Txt>}
        {detail ? (
          <Txt variant="footnote" tone="secondary">
            {detail}
          </Txt>
        ) : null}
      </View>
      {selected ? <Check size={size.icon} color={colors.text} strokeWidth={size.iconStroke} /> : null}
    </Pressable>
  );
}

export const choiceStyles = StyleSheet.create({
  header: { paddingHorizontal: space[5], paddingBottom: space[2], gap: space[1] },
  list: { paddingHorizontal: space[2] },
});

const styles = StyleSheet.create({
  fill: { flex: 1, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 52, paddingHorizontal: space[3], borderRadius: radius.md },
  pressed: { backgroundColor: colors.surface1 },
});
