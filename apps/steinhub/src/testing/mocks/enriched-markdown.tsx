import { Text } from "react-native";

/** The native renderer can't load in jest; tests read the Markdown source as plain text, escapes resolved. */
export function EnrichedMarkdownText({ markdown, onTextPress }: { markdown: string; onTextPress?: (event: { index: number; text: string }) => void }) {
  const text = markdown.replace(/\\([\s\S])/g, "$1");
  return <Text onPress={onTextPress ? () => onTextPress({ index: 0, text }) : undefined}>{text}</Text>;
}
