import { Appearance, Platform, type TextStyle } from "react-native";
import { startup, TEXT_SCALES } from "@/state/preferences";

const dark = {
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
  accent: "#4A6CF7",
  successBg: "rgba(61,214,140,0.12)",
  warningBg: "rgba(245,181,68,0.12)",
  dangerBg: "rgba(255,92,92,0.12)",
  infoBg: "rgba(108,168,255,0.12)",
  warningBorder: "rgba(245,181,68,0.25)",

  viewer: "#000000",
  onViewer: "#FFFFFF",
  onViewer2: "rgba(255,255,255,0.6)",
  viewerControl: "rgba(255,255,255,0.15)",
};

export type Palette = typeof dark;

const light: Palette = {
  bg: "#FFFFFF",
  bgRaised: "#F7F7F7",
  surface1: "#F2F2F2",
  surface2: "#E8E8E8",
  surface3: "#D9D9D9",
  border: "#E3E3E3",
  borderStrong: "#CCCCCC",
  scrim: "rgba(0,0,0,0.35)",

  text: "#0A0A0A",
  text2: "#5C5C5C",
  text3: "#8A8A8A",
  textInverse: "#FFFFFF",

  success: "#16955A",
  warning: "#A86A0C",
  danger: "#D92D2D",
  info: "#2563D9",
  accent: "#3557E8",
  successBg: "rgba(22,149,90,0.12)",
  warningBg: "rgba(168,106,12,0.12)",
  dangerBg: "rgba(217,45,45,0.10)",
  infoBg: "rgba(37,99,217,0.10)",
  warningBorder: "rgba(168,106,12,0.30)",

  viewer: "#000000",
  onViewer: "#FFFFFF",
  onViewer2: "rgba(255,255,255,0.6)",
  viewerControl: "rgba(255,255,255,0.15)",
};

// RN 0.88: an override set by a run before an in-app restart outlives it, so "system" clears it before reading.
Appearance.setColorScheme(startup.theme === "system" ? "unspecified" : startup.theme);

/** The scheme this run draws in: the saved choice, or the phone's own when it is "system". */
export const scheme: "dark" | "light" = startup.theme === "system" ? (Appearance.getColorScheme() === "light" ? "light" : "dark") : startup.theme;

export const colors: Palette = scheme === "light" ? light : dark;

export type Status = "success" | "warning" | "danger" | "info";

export const statusColors: Record<Status, { fg: string; bg: string }> = {
  success: { fg: colors.success, bg: colors.successBg },
  warning: { fg: colors.warning, bg: colors.warningBg },
  danger: { fg: colors.danger, bg: colors.dangerBg },
  info: { fg: colors.info, bg: colors.infoBg },
};

const darkTints = {
  violet: { bg: "#262040", glyph: "#C8B8FF" },
  green: { bg: "#1B3024", glyph: "#9FE0B5" },
  amber: { bg: "#33291A", glyph: "#F2C98A" },
  blue: { bg: "#1A2A3D", glyph: "#9CC4FF" },
  rose: { bg: "#3A1F27", glyph: "#FFB3C4" },
};

export type BotTint = keyof typeof darkTints;

const lightTints: Record<BotTint, { bg: string; glyph: string }> = {
  violet: { bg: "#ECE6FF", glyph: "#5B3FC4" },
  green: { bg: "#DFF3E6", glyph: "#1F7A44" },
  amber: { bg: "#FAEDD5", glyph: "#875811" },
  blue: { bg: "#E0ECFF", glyph: "#2559B8" },
  rose: { bg: "#FFE4EB", glyph: "#AF2F4F" },
};

export const botTints: Record<BotTint, { bg: string; glyph: string }> = scheme === "light" ? lightTints : darkTints;

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

/** The text size chosen in Settings, on top of the phone's own. */
export const textScale = TEXT_SCALES[startup.textSize];

function typeStyle(baseSize: number, baseLineHeight: number, fontWeight: TypeStyle["fontWeight"], trackingEm = 0): TypeStyle {
  const fontSize = Math.round(baseSize * textScale);
  return { fontSize, lineHeight: Math.round(baseLineHeight * textScale), fontWeight, letterSpacing: trackingEm * fontSize };
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
  avatarXs: 20,
  avatarSm: 28,
  avatarMd: 40,
  avatarHero: 52,
  avatarLg: 72,
  icon: 20,
  iconStroke: 1.75,
} as const;

export const shadowSheet = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: -8 },
  shadowOpacity: scheme === "light" ? 0.12 : 0.5,
  shadowRadius: 16,
  elevation: 24,
} as const;

export const motion = {
  easing: [0.2, 0, 0, 1] as const,
  durFast: 120,
  durBase: 220,
  caretBlink: 1000,
} as const;
