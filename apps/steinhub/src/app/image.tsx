import { router, useLocalSearchParams } from "expo-router";
import { X } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Txt } from "@/components/text";
import { useConnection } from "@/state/connection";
import { colors, size, space } from "@/theme";

const MAX_ZOOM = 5;

/** A chat image on its own, as large as the screen allows; pinch to zoom on iOS. `path` is an attachment on the paired
 * computer, `url` an image a reply linked to. */
export default function ImageViewer() {
  const { path, url, name } = useLocalSearchParams<{ path?: string; url?: string; name?: string }>();
  const { attachmentSource } = useConnection();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");
  const source = path ? attachmentSource(path) : url?.startsWith("/") ? attachmentSource(url) : url ? { uri: url } : null;
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  return (
    <View style={styles.backdrop} accessibilityViewIsModal>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.center}
        maximumZoomScale={MAX_ZOOM}
        minimumZoomScale={1}
        centerContent
        bouncesZoom
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        {source ? (
          <Image
            accessibilityLabel={name || "Image"}
            source={source}
            resizeMode="contain"
            style={{ width, height }}
            onLoad={() => setState("shown")}
            onError={() => setState("failed")}
          />
        ) : null}
      </ScrollView>
      {state === "loading" && source ? <ActivityIndicator color={colors.onViewer} style={StyleSheet.absoluteFill} /> : null}
      {state === "failed" || !source ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <Txt variant="subhead" style={styles.onBackdrop}>
            {source ? "This image couldn't be loaded." : "Pair a computer to see this image."}
          </Txt>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close image"
        onPress={close}
        hitSlop={12}
        style={[styles.close, { top: insets.top + space[2] }]}
      >
        <X size={size.icon + 4} color={colors.onViewer} strokeWidth={size.iconStroke} />
      </Pressable>
      {Platform.OS === "ios" && state === "shown" ? (
        <Txt variant="footnote" style={[styles.hint, { bottom: insets.bottom + space[4] }]}>
          Pinch to zoom
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.viewer },
  fill: { flex: 1 },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  onBackdrop: { color: colors.onViewer },
  close: {
    position: "absolute",
    left: space[4],
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.viewerControl,
  },
  hint: { position: "absolute", alignSelf: "center", color: colors.onViewer2 },
});
