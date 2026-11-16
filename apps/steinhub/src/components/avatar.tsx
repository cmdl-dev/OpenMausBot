import { StyleSheet, View } from "react-native";
import { Txt } from "@/components/text";
import { botTints, colors, size, type BotTint } from "@/theme";

const dimensions = {
  xs: { box: size.avatarXs, font: 10 },
  sm: { box: size.avatarSm, font: 12 },
  md: { box: size.avatarMd, font: 15 },
  hero: { box: size.avatarHero, font: 20 },
  lg: { box: size.avatarLg, font: 26 },
} as const;

export interface AvatarProps {
  label: string;
  tint?: BotTint;
  size?: keyof typeof dimensions;
}

export function Avatar({ label, tint, size: avatarSize = "md" }: AvatarProps) {
  const { box, font } = dimensions[avatarSize];
  const palette = tint ? botTints[tint] : { bg: colors.surface2, glyph: colors.text };
  return (
    <View style={[styles.avatar, { width: box, height: box, borderRadius: box / 2, backgroundColor: palette.bg }]}>
      <Txt weight="600" style={{ fontSize: font, lineHeight: font * 1.2, color: palette.glyph }}>
        {label.slice(0, 2).toUpperCase()}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: "center", justifyContent: "center" },
});
