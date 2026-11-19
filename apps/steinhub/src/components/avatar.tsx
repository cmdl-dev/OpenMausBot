import { Image, StyleSheet, View } from "react-native";
import { Mascot } from "@/components/mascot";
import { Txt } from "@/components/text";
import { useConnection } from "@/state/connection";
import type { BotView } from "@/state/views";
import { botTints, colors, size, type BotTint } from "@/theme";

const dimensions = {
  xs: { box: size.avatarXs, font: 10 },
  sm: { box: size.avatarSm, font: 12 },
  md: { box: size.avatarMd, font: 15 },
  hero: { box: size.avatarHero, font: 20 },
  lg: { box: size.avatarLg, font: 26 },
} as const;

const CROP_RADIUS = { circle: 0.5, rounded: 0.22, square: 0 } as const;

export interface AvatarProps {
  label: string;
  tint?: BotTint;
  size?: keyof typeof dimensions;
  /** A bot is drawn as it looks on the desktop: its mascot or its own picture. */
  bot?: BotView | null;
}

export function Avatar({ label, tint, size: avatarSize = "md", bot }: AvatarProps) {
  const { box, font } = dimensions[avatarSize];
  const { attachmentSource } = useConnection();
  const look = bot?.look;
  const picture = look?.picture ? attachmentSource(look.picture.path) : null;

  if (look && picture) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        source={picture}
        style={{ width: box, height: box, borderRadius: box * CROP_RADIUS[look.picture!.crop], backgroundColor: colors.surface2 }}
      />
    );
  }
  if (look) {
    return (
      <View style={[styles.avatar, { width: box, height: box }]}>
        <Mascot body={look.body} color={look.color} faceInk={look.faceInk} size={box} />
      </View>
    );
  }
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
