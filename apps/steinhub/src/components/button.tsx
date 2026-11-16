import type { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";
import { Txt } from "@/components/text";
import { colors, radius, size, space } from "@/theme";

const variants = {
  primary: { bg: colors.text, fg: colors.textInverse, border: colors.text },
  secondary: { bg: colors.surface2, fg: colors.text, border: colors.surface2 },
  outline: { bg: "transparent", fg: colors.text, border: colors.borderStrong },
  danger: { bg: colors.dangerBg, fg: colors.danger, border: "transparent" },
  ghost: { bg: "transparent", fg: colors.text2, border: "transparent" },
} as const;

export interface ButtonProps {
  label: string;
  icon?: LucideIcon;
  onPress?: () => void;
  variant?: keyof typeof variants;
  small?: boolean;
  block?: boolean;
  disabled?: boolean;
}

export function Button({ label, icon: Icon, onPress, variant = "primary", small, block, disabled }: ButtonProps) {
  const palette = variants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.small,
        block && styles.block,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {Icon ? <Icon size={small ? 16 : 18} color={palette.fg} strokeWidth={size.iconStroke} /> : null}
      <Txt variant={small ? "subhead" : "callout"} weight={variant === "ghost" ? "500" : "600"} style={{ color: palette.fg }}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 48,
    paddingHorizontal: space[5],
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
  },
  small: { height: 36, paddingHorizontal: 14 },
  block: { alignSelf: "stretch" },
});
