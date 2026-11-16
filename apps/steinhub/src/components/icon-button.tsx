import type { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, radius, size } from "@/theme";

export interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onPress?: () => void;
  filled?: boolean;
  dot?: boolean;
  dimension?: number;
  color?: string;
}

export function IconButton({ icon: Icon, label, onPress, filled, dot, dimension = size.tap, color = colors.text }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        { width: dimension, height: dimension },
        filled && styles.filled,
        pressed && styles.pressed,
      ]}
    >
      <Icon size={size.icon} color={color} strokeWidth={size.iconStroke} />
      {dot ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  filled: { backgroundColor: colors.surface2 },
  pressed: { backgroundColor: colors.surface3 },
  dot: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.bg,
  },
});
