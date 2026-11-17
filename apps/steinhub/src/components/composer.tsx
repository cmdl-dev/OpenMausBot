import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { ArrowUp, Camera, FileText, ImageIcon, Mic, Paperclip, Square, X, type LucideIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, TextInput, View, type TextInputInstance } from "react-native";
import { composeMessage, type SentAttachment } from "@/api/attachments";
import { problemText } from "@/api/errors";
import { DictationBar } from "@/components/dictation-bar";
import { IconButton } from "@/components/icon-button";
import { PasteImageButton, savePastedImage, useClipboardImage } from "@/components/paste-image";
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

/** How long Paste image stays after the field loses focus, so the tap that blurred it still lands. */
const PASTE_LINGER_MS = 600;

/** How long Done waits for the recognizer's last words before keeping what it has. */
const FINAL_RESULT_MS = 1500;

/** How long after Send the field refuses a whole line arriving at once. */
const ECHO_WINDOW_MS = 600;

/**
 * iOS (UIKit autocorrect, RN 0.88 Fabric) applies a pending correction when the field is cleared
 * and reports the old line, corrected, as a change. A person can't type more than a letter that fast.
 */
export function isClearEcho(next: string, clearedAt: number, now: number): boolean {
  return now - clearedAt < ECHO_WINDOW_MS && next.length > 1;
}

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

export interface Heard {
  settled: string;
  pending: string;
}

export const NOTHING_HEARD: Heard = { settled: "", pending: "" };

export function heardText(heard: Heard): string {
  return joined(heard.settled, heard.pending);
}

/**
 * In continuous mode the recognizer (iOS 18+ SFSpeechRecognizer, Android) ends an utterance at each pause and
 * reports the next one on its own, so a final result is kept and later results add after it.
 */
export function hear(heard: Heard, event: { isFinal?: boolean; results: { transcript: string }[] }): Heard {
  const transcript = event.results[0]?.transcript.trim() ?? "";
  if (!event.isFinal) return transcript ? { ...heard, pending: transcript } : heard;
  if (!transcript) return { settled: heardText(heard), pending: "" };
  if (!heard.pending && heard.settled.endsWith(transcript)) return heard;
  return { settled: joined(heard.settled, transcript), pending: "" };
}

export function Composer({ botName, onSend, text: controlled, onChangeText, onStop }: ComposerProps) {
  const connection = useConnection();
  const live = connection.mode === "live";
  const [own, setOwn] = useState("");
  const text = controlled ?? own;
  const setText = onChangeText ?? setOwn;
  const [chips, setChips] = useState<Chip[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipboard = useClipboardImage();
  const [pastedAt, setPastedAt] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dictation, setDictation] = useState<{ spoken: string; finishing: boolean } | null>(null);
  const listening = useRef(false);
  const textBefore = useRef("");
  const spoken = useRef<Heard>(NOTHING_HEARD);
  const keepSpoken = useRef(true);
  const clearedAt = useRef(0);
  const input = useRef<TextInputInstance>(null);

  function typed(next: string) {
    if (isClearEcho(next, clearedAt.current, Date.now())) {
      input.current?.clear();
      return;
    }
    setText(next);
  }

  const uploading = chips.some((chip) => !chip.sent && !chip.failed);
  const ready = chips.flatMap((chip) => (chip.sent ? [chip.sent] : []));
  const canSend = (text.trim().length > 0 || ready.length > 0) && !uploading;
  const showStop = Boolean(onStop) && !canSend && !uploading;

  useSpeechRecognitionEvent("result", (event) => {
    if (!listening.current) return;
    spoken.current = hear(spoken.current, event);
    setDictation((current) => current && { ...current, spoken: heardText(spoken.current) });
  });
  useSpeechRecognitionEvent("end", () => finishDictation());
  useSpeechRecognitionEvent("error", (event) => {
    if (event.error !== "aborted" && event.error !== "no-speech") setNote("Dictation stopped. Tap the mic to try again.");
    finishDictation();
  });

  useEffect(
    () => () => {
      if (listening.current) ExpoSpeechRecognitionModule.abort();
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    [],
  );

  function finishDictation() {
    if (!listening.current) return;
    listening.current = false;
    const words = heardText(spoken.current);
    if (keepSpoken.current && words) setText(joined(textBefore.current, words));
    setDictation(null);
  }

  async function startDictation() {
    setNote(null);
    setMenuOpen(false);
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setNote("Dictation needs microphone and speech recognition access. Turn them on for SteinHub in Settings.");
      return;
    }
    textBefore.current = text;
    spoken.current = NOTHING_HEARD;
    keepSpoken.current = true;
    listening.current = true;
    setDictation({ spoken: "", finishing: false });
    ExpoSpeechRecognitionModule.start({
      lang: locale(),
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
      iosTaskHint: "dictation",
      volumeChangeEventOptions: { enabled: true, intervalMillis: 80 },
    });
  }

  function doneDictating() {
    setDictation((current) => current && { ...current, finishing: true });
    ExpoSpeechRecognitionModule.stop();
    setTimeout(finishDictation, FINAL_RESULT_MS);
  }

  function cancelDictation() {
    keepSpoken.current = false;
    ExpoSpeechRecognitionModule.abort();
    finishDictation();
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

  function paste(dataUri: string) {
    setPastedAt(clipboard.version);
    setMenuOpen(false);
    savePastedImage(dataUri).then(
      (pick) => attach([pick]),
      (error: unknown) => setNote(error instanceof Error ? error.message : "Couldn't paste that image."),
    );
  }

  const offerPaste = clipboard.hasImage && pastedAt !== clipboard.version && (focused || menuOpen);

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
    const words = text.trim();
    const kept = chips;
    clearedAt.current = Date.now();
    input.current?.clear();
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
      {offerPaste && !dictation ? <PasteImageButton onImage={paste} onError={setNote} /> : null}
      {dictation ? (
        <DictationBar transcript={dictation.spoken} finishing={dictation.finishing} onCancel={cancelDictation} onDone={doneDictating} />
      ) : (
        <View style={styles.pill}>
          <IconButton
            icon={menuOpen ? X : Paperclip}
            label={menuOpen ? "Close attach menu" : "Attach"}
            dimension={40}
            color={colors.text2}
            onPress={() => setMenuOpen((open) => !open)}
          />
          <TextInput
            ref={input}
            accessibilityLabel="Message"
            value={text}
            onChangeText={typed}
            onFocus={() => {
              if (blurTimer.current) clearTimeout(blurTimer.current);
              setFocused(true);
            }}
            onBlur={() => {
              blurTimer.current = setTimeout(() => setFocused(false), PASTE_LINGER_MS);
            }}
            placeholder={`Ask ${botName} anything`}
            placeholderTextColor={colors.text3}
            selectionColor={colors.text}
            multiline
            style={styles.input}
          />
          <IconButton icon={Mic} label="Dictate" dimension={40} color={colors.text2} onPress={() => void startDictation()} />
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
      )}
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
