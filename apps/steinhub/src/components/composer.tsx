import { ArrowUp, Mic, Paperclip } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { IconButton } from "@/components/icon-button";
import { colors, radius, size, space, type } from "@/theme";

export interface ComposerProps {
  botName: string;
  onSend?: (text: string) => void;
}

export function Composer({ botName, onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0;

  function send() {
    if (!canSend) return;
    onSend?.(text.trim());
    setText("");
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.pill}>
        <IconButton icon={Paperclip} label="Attach" dimension={40} color={colors.text2} />
        <TextInput
          accessibilityLabel="Message"
          value={text}
          onChangeText={setText}
          placeholder={`Ask ${botName} anything`}
          placeholderTextColor={colors.text3}
          selectionColor={colors.text}
          multiline
          style={styles.input}
        />
        <IconButton icon={Mic} label="Voice" dimension={40} color={colors.text2} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend }}
          onPress={send}
          style={[styles.send, canSend ? styles.sendReady : styles.sendIdle]}
        >
          <ArrowUp size={size.icon} color={canSend ? colors.textInverse : colors.text3} strokeWidth={size.iconStroke} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space[3], paddingTop: space[2], paddingBottom: space[2] },
  pill: {
    minHeight: size.composer,
    borderRadius: size.composer / 2,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingVertical: space[1],
    paddingLeft: space[1],
    paddingRight: 6,
  },
  input: {
    ...type.callout,
    flex: 1,
    color: colors.text,
    paddingHorizontal: 6,
    paddingVertical: space[2],
    maxHeight: type.callout.lineHeight * 6 + space[4],
  },
  send: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  sendReady: { backgroundColor: colors.text },
  sendIdle: { backgroundColor: colors.surface3 },
});
