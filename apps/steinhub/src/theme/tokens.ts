import { Platform, type TextStyle } from "react-native";

export const colors = {
  bg: "#000000",
  bgRaised: "#0A0A0A",
  surface1: "#151515",
  surface2: "#1F1F1F",
  surface3: "#2A2A2A",
  border: "#242424",
  borderStrong: "#333333",
  scrim: "rgba(0,0,0,0.6)",

  text: "#FFFFFF",
  text2: "#A1A1A1",
  text3: "#6B6B6B",
  textInverse: "#000000",

  success: "#3DD68C",
  warning: "#F5B544",
  danger: "#FF5C5C",
  info: "#6CA8FF",
  successBg: "rgba(61,214,140,0.12)",
  warningBg: "rgba(245,181,68,0.12)",
  dangerBg: "rgba(255,92,92,0.12)",
  infoBg: "rgba(108,168,255,0.12)",
} as const;

export type Status = "success" | "warning" | "danger" | "info";

export const statusColors: Record<Status, { fg: string; bg: string }> = {
  success: { fg: colors.success, bg: colors.successBg },
  warning: { fg: colors.warning, bg: colors.warningBg },
  danger: { fg: colors.danger, bg: colors.dangerBg },
  info: { fg: colors.info, bg: colors.infoBg },
};

export const botTints = {
  violet: { bg: "#262040", glyph: "#C8B8FF" },
  green: { bg: "#1B3024", glyph: "#9FE0B5" },
  amber: { bg: "#33291A", glyph: "#F2C98A" },
  blue: { bg: "#1A2A3D", glyph: "#9CC4FF" },
  rose: { bg: "#3A1F27", glyph: "#FFB3C4" },
} as const;

export type BotTint = keyof typeof botTints;

export const botTintOrder: readonly BotTint[] = ["violet", "green", "amber", "blue", "rose"];

export function tintForIndex(index: number): BotTint {
  return botTintOrder[((index % botTintOrder.length) + botTintOrder.length) % botTintOrder.length];
}

export const fonts = {
  sans: Platform.select({ ios: "System", default: "sans-serif" }),
  mono: Platform.select({ ios: "Menlo", default: "monospace" }),
} as const;

interface TypeStyle extends TextStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: "400" | "500" | "600";
  letterSpacing: number;
}

function typeStyle(fontSize: number, lineHeight: number, fontWeight: TypeStyle["fontWeight"], trackingEm = 0): TypeStyle {
  return { fontSize, lineHeight, fontWeight, letterSpacing: trackingEm * fontSize };
}

export const type = {
  display: typeStyle(30, 36, "600", -0.02),
  title: typeStyle(22, 28, "600", -0.01),
  headline: typeStyle(17, 22, "600"),
  body: typeStyle(16, 24, "400"),
  callout: typeStyle(15, 20, "400"),
  subhead: typeStyle(14, 20, "400"),
  footnote: typeStyle(13, 18, "400"),
  caption: typeStyle(12, 16, "500"),
  overline: { ...typeStyle(11, 14, "600", 0.06), textTransform: "uppercase" },
} satisfies Record<string, TypeStyle>;

export type TypeToken = keyof typeof type;

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const size = {
  tap: 44,
  topbar: 52,
  composer: 52,
  avatarSm: 28,
  avatarMd: 40,
  avatarLg: 72,
  icon: 20,
  iconStroke: 1.75,
} as const;

export const shadowSheet = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: -8 },
  shadowOpacity: 0.5,
  shadowRadius: 16,
  elevation: 24,
} as const;

export const motion = {
  easing: [0.2, 0, 0, 1] as const,
  durFast: 120,
  durBase: 220,
  caretBlink: 1000,
} as const;
