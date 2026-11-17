import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { problemText } from "@/api/errors";
import { Button } from "@/components/button";
import { SheetContent } from "@/components/sheet";
import { Txt } from "@/components/text";
import { useConnection } from "@/state/connection";
import { useWorld } from "@/state/world";
import { colors, radius, space, type } from "@/theme";

const EMOJIS = ["📁", "💼", "🛒", "📦", "📈", "🧾", "✉️", "🛠️", "🎮", "⭐"];
const MAX_NAME = 80;

/** Name a new folder for a bot's threads, with an emoji if wanted. */
export default function NewFolderSheet() {
  const { bot: botId } = useLocalSearchParams<{ bot: string }>();
  const world = useWorld();
  const connection = useConnection();
  const bot = world.bot(botId);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!bot) return;
    setBusy(true);
    setError(null);
    try {
      if (world.source === "live") await connection.newFolder(bot.id, { name: name.trim(), ...(emoji ? { emoji } : {}) });
      router.back();
    } catch (failure) {
      setError(problemText(failure, world.host.name));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetContent
      label="New folder"
      header={
        <View style={styles.header}>
          <Txt variant="headline">New folder</Txt>
          <Txt variant="subhead" tone="secondary">
            {bot ? `For ${bot.name}'s threads.` : "This bot isn't on the computer any more."}
          </Txt>
        </View>
      }
    >
      <View style={styles.form}>
        <Txt variant="footnote" tone="secondary" weight="500">
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
          returnKeyType="done"
          onSubmitEditing={() => {
            if (name.trim() && !busy) void create();
          }}
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
        <Button label={busy ? "Creating…" : "Create folder"} block disabled={!bot || busy || !name.trim()} onPress={() => void create()} />
      </View>
    </SheetContent>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space[5], paddingBottom: space[2], gap: space[1] },
  form: { paddingHorizontal: space[5], gap: space[2] },
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
