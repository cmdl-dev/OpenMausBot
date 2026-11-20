import * as Clipboard from "expo-clipboard";
import { useRef } from "react";
import { Share, View, type GestureResponderEvent } from "react-native";
import { showMenu } from "../../modules/steinhub-menu";
import { Markdown } from "@/components/markdown";

const actions = [
  { title: "Copy", icon: "doc.on.doc", run: (text: string) => Clipboard.setStringAsync(text) },
  { title: "Share", icon: "square.and.arrow.up", run: (text: string) => Share.share({ message: text }) },
];

/**
 * A message's words. A tap pops up Copy and Share for the whole message; a long press selects words,
 * and letting go offers the system's Copy for just those.
 * `literal` draws the text exactly as typed instead of as Markdown.
 */
export function MessageText({ text, literal = false, fadesIn }: { text: string; literal?: boolean; fadesIn?: boolean }) {
  const touch = useRef({ x: 0, y: 0 });

  function remember({ nativeEvent }: GestureResponderEvent) {
    touch.current = { x: nativeEvent.pageX, y: nativeEvent.pageY };
  }

  async function openMenu() {
    const chosen = await showMenu(touch.current, actions);
    await chosen?.run(text).catch(() => undefined);
  }

  return (
    <View onTouchStart={remember}>
      <Markdown fadesIn={fadesIn} literal={literal} onTextPress={() => void openMenu()}>
        {text}
      </Markdown>
    </View>
  );
}
