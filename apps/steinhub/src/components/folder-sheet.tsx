import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/button";
import { Txt } from "@/components/text";
import { colors, radius, shadowSheet, space, type } from "@/theme";

const EMOJIS = ["📁", "💼", "🛒", "📦", "📈", "🧾", "✉️", "🛠️", "🎮", "⭐"];
const MAX_NAME = 80;

/** Name a new folder for a bot's threads, with an emoji if wanted. */
export function FolderSheet({
  botName,
  visible,
  onCreate,
  onClose,
}: {
  botName: string;
  visible: boolean;
  onCreate: (folder: { name: string; emoji?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setName("");
    setEmoji(undefined);
    setError(null);
    onClose();
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), ...(emoji ? { emoji } : {}) });
      close();
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Couldn't make the folder. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable accessibilityLabel="Close" style={styles.fill} onPress={close} />
        <SafeAreaView edges={["bottom"]} style={styles.sheet}>
          <View style={styles.grabber} />
          <Txt variant="headline">New folder</Txt>
          <Txt variant="subhead" tone="secondary">
            For {botName}&apos;s threads.
          </Txt>
          <Txt variant="footnote" tone="secondary" weight="500" style={styles.label}>
            Name
          </Txt>
          <TextInput
            accessibilityLabel="Folder name"
            value={name}
            onChangeText={setName}
            maxLength={MAX_NAME}
            autoFocus
            placeholder="Listings"
            placeholderTextColor={colors.text3}
            selectionColor={colors.text}
            style={styles.input}
          />
          <Txt variant="footnote" tone="secondary" weight="500" style={styles.label}>
            Icon
          </Txt>
          <View style={styles.emojis}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="No icon"
              accessibilityState={{ selected: emoji === undefined }}
              onPress={() => setEmoji(undefined)}
              style={[styles.emoji, emoji === undefined && styles.emojiSelected]}
            >
              <Txt variant="footnote" tone="secondary">
                None
              </Txt>
            </Pressable>
            {EMOJIS.map((choice) => (
              <Pressable
                key={choice}
                accessibilityRole="button"
                accessibilityLabel={`Icon ${choice}`}
                accessibilityState={{ selected: emoji === choice }}
                onPress={() => setEmoji(choice)}
                style={[styles.emoji, emoji === choice && styles.emojiSelected]}
              >
                <Txt variant="title">{choice}</Txt>
              </Pressable>
            ))}
          </View>
          {error ? (
            <Txt variant="footnote" style={styles.error}>
              {error}
            </Txt>
          ) : null}
          <Button label={busy ? "Creating…" : "Create folder"} block disabled={busy || !name.trim()} onPress={() => void create()} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: {
    backgroundColor: colors.bgRaised,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space[4],
    paddingBottom: space[4],
    gap: space[2],
    ...shadowSheet,
  },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.surface3, marginVertical: space[2] },
  label: { marginTop: space[2] },
  input: {
    ...type.callout,
    color: colors.text,
    height: 48,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  emojis: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginBottom: space[3] },
  emoji: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: space[2],
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emojiSelected: { borderColor: colors.text },
  error: { color: colors.danger },
});
