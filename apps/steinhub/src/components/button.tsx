import { Pressable, StyleSheet } from "react-native";
import { Txt } from "@/components/text";
import { colors, radius, space } from "@/theme";

const variants = {
  primary: { bg: colors.text, fg: colors.textInverse, border: colors.text },
  secondary: { bg: colors.surface2, fg: colors.text, border: colors.surface2 },
  outline: { bg: "transparent", fg: colors.text, border: colors.borderStrong },
  danger: { bg: colors.dangerBg, fg: colors.danger, border: "transparent" },
} as const;

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: keyof typeof variants;
  small?: boolean;
  block?: boolean;
}

export function Button({ label, onPress, variant = "primary", small, block }: ButtonProps) {
  const palette = variants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.small,
        block && styles.block,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Txt variant={small ? "subhead" : "callout"} weight="600" style={{ color: palette.fg }}>
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
    alignItems: "center",
    justifyContent: "center",
  },
  small: { height: 36, paddingHorizontal: 14 },
  block: { alignSelf: "stretch" },
});
