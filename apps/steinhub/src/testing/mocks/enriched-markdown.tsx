import { Text } from "react-native";

/** The native renderer can't load in jest; tests read the Markdown source as plain text. */
export function EnrichedMarkdownText({ markdown }: { markdown: string }) {
  return <Text>{markdown}</Text>;
}
