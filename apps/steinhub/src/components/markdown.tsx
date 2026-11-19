import { router } from "expo-router";
import { Linking, Platform, StyleSheet } from "react-native";
import { EnrichedMarkdownText, type MarkdownStyle } from "react-native-enriched-markdown";
import { colors, radius, type } from "@/theme";

const monospace = Platform.select({ ios: "Menlo", default: "monospace" });

const body = {
  color: colors.text,
  fontSize: type.body.fontSize,
  lineHeight: type.body.lineHeight,
  marginTop: 0,
  marginBottom: 8,
};

const block = {
  marginTop: 4,
  marginBottom: 12,
  borderRadius: radius.sm,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: colors.borderStrong,
};

function heading(size: number) {
  return { ...body, fontSize: size, lineHeight: Math.round(size * 1.35), fontWeight: "600" as const, marginTop: 8 };
}

const markdownStyle: MarkdownStyle = {
  paragraph: body,
  h1: heading(type.title.fontSize),
  h2: heading(type.headline.fontSize + 2),
  h3: heading(type.headline.fontSize),
  h4: heading(type.body.fontSize),
  h5: heading(type.callout.fontSize),
  h6: heading(type.subhead.fontSize),
  strong: { color: colors.text, fontWeight: "bold" },
  link: { color: colors.info, underline: true },
  code: {
    fontFamily: monospace,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderColor: "transparent",
    fontSize: type.body.fontSize * 0.9,
  },
  codeBlock: {
    ...body,
    ...block,
    color: colors.text,
    backgroundColor: colors.surface1,
    fontFamily: monospace,
    fontSize: type.body.fontSize * 0.85,
    padding: 12,
  },
  blockquote: { ...body, color: colors.text2, backgroundColor: "transparent", borderColor: colors.borderStrong, borderWidth: 2, gapWidth: 12 },
  list: { ...body, bulletColor: colors.text2, markerColor: colors.text2, gapWidth: 12 },
  thematicBreak: { color: colors.border, height: 1, marginTop: 8, marginBottom: 8 },
  table: {
    ...body,
    ...block,
    fontSize: type.subhead.fontSize,
    lineHeight: type.subhead.lineHeight,
    headerTextColor: colors.text,
    headerBackgroundColor: colors.surface2,
    rowEvenBackgroundColor: colors.surface1,
    rowOddBackgroundColor: colors.bgRaised,
    borderColor: colors.border,
    cellPaddingHorizontal: 12,
    cellPaddingVertical: 8,
  },
};

/**
 * A bot's words as the desktop draws them: GitHub-flavored Markdown with tables, lists and links.
 * `fadesIn` fades in text appended after the first draw, for a reply that streams.
 */
export function Markdown({ children, fadesIn = false }: { children: string; fadesIn?: boolean }) {
  return (
    <EnrichedMarkdownText
      markdown={children}
      streamingAnimation={fadesIn}
      markdownStyle={markdownStyle}
      flavor="github"
      selectable
      containerStyle={styles.container}
      onLinkPress={({ url }) => void Linking.openURL(url).catch(() => undefined)}
      onImagePress={({ url, altText }) => router.push({ pathname: "/image", params: { url, name: altText } })}
    />
  );
}

const styles = StyleSheet.create({
  container: { flexShrink: 1, minWidth: 0 },
});
