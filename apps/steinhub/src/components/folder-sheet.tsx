import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Button } from "@/components/button";
import { Sheet } from "@/components/sheet";
import { Txt } from "@/components/text";
import { colors, radius, space, type } from "@/theme";

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
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : "Couldn't make the folder. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={visible} onClose={close} label="New folder" avoidKeyboard>
      <View style={styles.sheet}>
        <Txt variant="headline">New folder</Txt>
        <Txt variant="subhead" tone="secondary">
          For {botName}&apos;s threads.
        </Txt>
        <Txt
          variant="footnote"
          tone="secondary"
          weight="500"
          style={styles.label}
        >
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
        <Txt
          variant="footnote"
          tone="secondary"
          weight="500"
          style={styles.label}
        >
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
        <Button
          label={busy ? "Creating…" : "Create folder"}
          block
          disabled={busy || !name.trim()}
          onPress={() => void create()}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: space[4],
    paddingTop: space[1],
    paddingBottom: space[4],
    gap: space[2],
  },
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
  emojis: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    marginBottom: space[3],
  },
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
