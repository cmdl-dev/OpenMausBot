import { Text, type TextProps } from "react-native";
import { colors, fonts, type, type TypeToken } from "@/theme";

const tones = {
  primary: colors.text,
  secondary: colors.text2,
  tertiary: colors.text3,
  inverse: colors.textInverse,
} as const;

export type TextTone = keyof typeof tones;

export interface TxtProps extends TextProps {
  variant?: TypeToken;
  tone?: TextTone;
  weight?: "400" | "500" | "600";
  mono?: boolean;
}

export function Txt({ variant = "body", tone = "primary", weight, mono, style, ...rest }: TxtProps) {
  return (
    <Text
      {...rest}
      style={[
        type[variant],
        { color: tones[tone], fontFamily: mono ? fonts.mono : fonts.sans },
        weight ? { fontWeight: weight } : null,
        style,
      ]}
    />
  );
}
