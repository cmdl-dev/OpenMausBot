import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import { ClipboardPaste } from "lucide-react-native";
import { useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet } from "react-native";
import { Txt } from "@/components/text";
import { colors, radius, size, space } from "@/theme";

const PASTE_FORMAT: Clipboard.GetImageOptions = { format: "jpeg", jpegQuality: 0.85 };

/** Whether the clipboard holds an image, and a count that moves each time the clipboard changes. iOS answers this
 * without the "Allow Paste" prompt; reading the image does not. */
export function useClipboardImage(): { hasImage: boolean; version: number } {
  const [hasImage, setHasImage] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    const check = () =>
      void Clipboard.hasImageAsync()
        .then((found) => {
          if (live) setHasImage(Boolean(found));
        })
        .catch(() => {});
    check();
    const clipboard = Clipboard.addClipboardListener(() => {
      setVersion((current) => current + 1);
      check();
    });
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => {
      live = false;
      clipboard.remove();
      app.remove();
    };
  }, []);
  return { hasImage, version };
}

/** A pasted image, written where the upload reads files from. */
export async function savePastedImage(dataUri: string, now = Date.now()): Promise<{ uri: string; name: string; mime: string; kind: "image" }> {
  const match = /^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(dataUri);
  if (!match) throw new Error("The clipboard didn't hold an image SteinHub can read.");
  const mime = match[1]!;
  const name = `pasted-${now}.${mime === "image/png" ? "png" : "jpg"}`;
  const file = new File(Paths.cache, name);
  await file.write(match[2]!, { encoding: "base64" });
  return { uri: file.uri, name, mime, kind: "image" };
}

/** Paste an image from the clipboard. On iOS 16+ it is the system's own Paste control, which reads the clipboard without
 * asking; elsewhere a button that reads it directly. */
export function PasteImageButton({ onImage, onError }: { onImage: (dataUri: string) => void; onError: (message: string) => void }) {
  if (Clipboard.isPasteButtonAvailable) {
    return (
      <Clipboard.ClipboardPasteButton
        accessibilityLabel="Paste image"
        acceptedContentTypes={["image"]}
        imageOptions={PASTE_FORMAT}
        displayMode="iconAndLabel"
        cornerStyle="capsule"
        backgroundColor={colors.surface2}
        foregroundColor={colors.text}
        style={styles.system}
        onPress={(data) => {
          if (data.type === "image") onImage(data.data);
          else onError("There's no image on the clipboard.");
        }}
      />
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Paste image"
      onPress={() =>
        void Clipboard.getImageAsync(PASTE_FORMAT).then(
          (image) => (image ? onImage(image.data) : onError("There's no image on the clipboard.")),
          () => onError("Couldn't read the clipboard. Try again."),
        )
      }
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <ClipboardPaste size={16} color={colors.text} strokeWidth={size.iconStroke} />
      <Txt variant="footnote" weight="500">
        Paste image
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  system: { height: 36, width: 120 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    alignSelf: "flex-start",
    height: 36,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  pressed: { opacity: 0.7 },
});
