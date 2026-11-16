import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { ArrowUp, Camera, FileText, ImageIcon, Mic, Paperclip, Square, X, type LucideIcon } from "lucide-react-native";
import { useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, TextInput, View } from "react-native";
import { composeMessage, type SentAttachment } from "@/api/attachments";
import { problemText } from "@/api/errors";
import { IconButton } from "@/components/icon-button";
import { Txt } from "@/components/text";
import { useConnection } from "@/state/connection";
import { colors, radius, size, space, type } from "@/theme";

export interface ComposerProps {
  botName: string;
  /** Receives the words with any attached files' tags. A rejected promise puts the words and files back. */
  onSend?: (text: string) => void | Promise<unknown>;
  text?: string;
  onChangeText?: (text: string) => void;
  /** A reply is streaming: an empty field offers Stop instead of Send. */
  onStop?: () => void;
}

interface Pick {
  uri: string;
  name: string;
  mime: string;
  kind: "image" | "file";
}

interface Chip {
  id: string;
  pick: Pick;
  sent?: SentAttachment;
  failed?: string;
}

const PHOTO_LIMIT = 5;

function locale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  } catch {
    return "en-US";
  }
}

function joined(before: string, spoken: string): string {
  const head = before.trimEnd();
  return head && spoken ? `${head} ${spoken}` : head || spoken;
}

export function Composer({ botName, onSend, text: controlled, onChangeText, onStop }: ComposerProps) {
  const connection = useConnection();
  const live = connection.mode === "live";
  const [own, setOwn] = useState("");
  const text = controlled ?? own;
  const setText = onChangeText ?? setOwn;
  const [chips, setChips] = useState<Chip[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const spokenFrom = useRef("");

  const uploading = chips.some((chip) => !chip.sent && !chip.failed);
  const ready = chips.flatMap((chip) => (chip.sent ? [chip.sent] : []));
  const canSend = (text.trim().length > 0 || ready.length > 0) && !uploading;
  const showStop = Boolean(onStop) && !canSend && !uploading;

  useSpeechRecognitionEvent("start", () => setListening(true));
  useSpeechRecognitionEvent("end", () => setListening(false));
  useSpeechRecognitionEvent("result", (event) => {
    setText(joined(spokenFrom.current, event.results[0]?.transcript ?? ""));
  });
  useSpeechRecognitionEvent("error", (event) => {
    setListening(false);
    if (event.error !== "aborted" && event.error !== "no-speech") setNote("Dictation stopped. Tap the mic to try again.");
  });

  async function toggleDictation() {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    setNote(null);
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setNote("Dictation needs microphone and speech recognition access. Turn them on for SteinHub in Settings.");
      return;
    }
    spokenFrom.current = text;
    ExpoSpeechRecognitionModule.start({
      lang: locale(),
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
      iosTaskHint: "dictation",
    });
  }

  function attach(picks: Pick[]) {
    if (!live) {
      setNote("Pair a computer to send photos and files.");
      return;
    }
    const added = picks.map((pick) => ({ id: `${Date.now()}-${Math.random()}`, pick }));
    setChips((current) => [...current, ...added]);
    for (const chip of added) {
      connection.upload(chip.pick).then(
        (sent) => setChips((current) => current.map((entry) => (entry.id === chip.id ? { ...entry, sent } : entry))),
        (error: unknown) =>
          setChips((current) =>
            current.map((entry) =>
              entry.id === chip.id ? { ...entry, failed: error instanceof Error && !("kind" in error) ? error.message : problemText(error) } : entry,
            ),
          ),
      );
    }
  }

  function pickFromMenu(source: Source) {
    choose(source)
      .catch((error: unknown) => setNote(error instanceof Error ? `Couldn't open that: ${error.message}` : "Couldn't open that. Try again."))
      .finally(() => setMenuOpen(false));
  }

  async function choose(source: Source) {
    if (source === "files") {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      attach(result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mime: asset.mimeType ?? "application/octet-stream", kind: "file" })));
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      quality: 0.85,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    };
    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setNote("Taking a photo needs camera access. Turn it on for SteinHub in Settings.");
        return;
      }
    }
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: PHOTO_LIMIT });
    if (result.canceled) return;
    attach(
      result.assets.map((asset, index) => ({
        uri: asset.uri,
        name: asset.fileName ?? `photo-${index + 1}.jpg`,
        mime: asset.mimeType ?? "image/jpeg",
        kind: "image",
      })),
    );
  }

  async function send() {
    if (!canSend) return;
    if (listening) ExpoSpeechRecognitionModule.stop();
    const words = text.trim();
    const kept = chips;
    setText("");
    setChips([]);
    setNote(null);
    try {
      await onSend?.(composeMessage(words, ready));
    } catch {
      setText(words);
      setChips(kept);
    }
  }

  return (
    <View style={styles.wrap}>
      {note ? (
        <Txt variant="footnote" tone="secondary" style={styles.note}>
          {note}
        </Txt>
      ) : null}
      {chips.length ? (
        <View style={styles.chips}>
          {chips.map((chip) => (
            <View key={chip.id} style={[styles.chip, chip.failed ? styles.chipFailed : null]}>
              {chip.pick.kind === "image" ? (
                <Image source={{ uri: chip.pick.uri }} style={styles.thumb} />
              ) : (
                <FileText size={16} color={colors.text2} strokeWidth={size.iconStroke} />
              )}
              <Txt variant="footnote" numberOfLines={1} style={styles.chipName}>
                {chip.failed ?? chip.pick.name}
              </Txt>
              {!chip.sent && !chip.failed ? <ActivityIndicator size="small" color={colors.text3} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${chip.pick.name}`}
                hitSlop={8}
                onPress={() => setChips((current) => current.filter((entry) => entry.id !== chip.id))}
              >
                <X size={14} color={colors.text2} strokeWidth={size.iconStroke} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {menuOpen ? <AttachMenu onChoose={pickFromMenu} /> : null}
      <View style={styles.pill}>
        <IconButton
          icon={menuOpen ? X : Paperclip}
          label={menuOpen ? "Close attach menu" : "Attach"}
          dimension={40}
          color={colors.text2}
          onPress={() => setMenuOpen((open) => !open)}
        />
        <TextInput
          accessibilityLabel="Message"
          value={text}
          onChangeText={setText}
          placeholder={listening ? "Listening…" : `Ask ${botName} anything`}
          placeholderTextColor={colors.text3}
          selectionColor={colors.text}
          multiline
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={listening ? "Stop dictation" : "Dictate"}
          accessibilityState={{ selected: listening }}
          onPress={() => void toggleDictation()}
          style={[styles.mic, listening && styles.micOn]}
        >
          <Mic size={size.icon} color={listening ? colors.textInverse : colors.text2} strokeWidth={size.iconStroke} />
        </Pressable>
        {showStop ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Stop" onPress={onStop} style={[styles.send, styles.sendReady]}>
            <Square size={14} color={colors.textInverse} fill={colors.textInverse} strokeWidth={size.iconStroke} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            onPress={() => void send()}
            style={[styles.send, canSend ? styles.sendReady : styles.sendIdle]}
          >
            <ArrowUp size={size.icon} color={canSend ? colors.textInverse : colors.text3} strokeWidth={size.iconStroke} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

type Source = "camera" | "photos" | "files";

const SOURCES: Array<{ source: Source; label: string; icon: LucideIcon }> = [
  { source: "camera", label: "Camera", icon: Camera },
  { source: "photos", label: "Photos", icon: ImageIcon },
  { source: "files", label: "Files", icon: FileText },
];

/** Drawn in place above the field, not in a modal: iOS will not present a picker over a modal that is still closing. */
function AttachMenu({ onChoose }: { onChoose: (source: Source) => void }) {
  return (
    <View style={styles.menu}>
      {SOURCES.map(({ source, label, icon: Icon }) => (
        <Pressable
          key={source}
          accessibilityRole="button"
          onPress={() => onChoose(source)}
          style={({ pressed }) => [styles.menuRow, pressed && styles.menuPressed]}
        >
          <Icon size={size.icon} color={colors.text} strokeWidth={size.iconStroke} />
          <Txt variant="callout">{label}</Txt>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space[3], paddingTop: space[2], paddingBottom: space[2], gap: space[2] },
  note: { paddingHorizontal: space[2] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    maxWidth: "100%",
    height: 40,
    paddingLeft: space[1],
    paddingRight: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipFailed: { borderColor: colors.danger },
  thumb: { width: 30, height: 30, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  chipName: { flexShrink: 1, maxWidth: 180 },
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
  mic: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  micOn: { backgroundColor: colors.danger },
  send: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  sendReady: { backgroundColor: colors.text },
  sendIdle: { backgroundColor: colors.surface3 },
  menu: {
    alignSelf: "flex-start",
    minWidth: 220,
    paddingVertical: space[1],
    borderRadius: radius.lg,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: size.tap, paddingHorizontal: space[4] },
  menuPressed: { backgroundColor: colors.surface1 },
});
