import type { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";
import { Txt } from "@/components/text";
import { colors, radius, size } from "@/theme";

export interface ChipProps {
  label: string;
  icon?: LucideIcon;
  selected?: boolean;
  count?: number;
  onPress?: () => void;
}

export function Chip({ label, icon: Icon, selected, count, onPress }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.selected]}
    >
      {Icon ? <Icon size={16} color={selected ? colors.textInverse : colors.text2} strokeWidth={size.iconStroke} /> : null}
      <Txt variant="subhead" weight="500" tone={selected ? "inverse" : "primary"}>
        {label}
      </Txt>
      {count !== undefined ? (
        <Txt variant="subhead" tone={selected ? "inverse" : "tertiary"}>
          {count}
        </Txt>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  selected: { backgroundColor: colors.text, borderColor: colors.text },
});
