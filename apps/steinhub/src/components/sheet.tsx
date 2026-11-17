import type { ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space } from "@/theme";

const BODY_SHARE = 0.7;

/** Every sheet is a route presented as the platform's own sheet, sized to what it shows. */
export const sheetScreenOptions = {
  presentation: "formSheet",
  sheetAllowedDetents: "fitToContents",
  sheetGrabberVisible: true,
  sheetCornerRadius: radius.xl,
  contentStyle: { backgroundColor: colors.bgRaised },
} as const;

/** The inside of a sheet: a fixed header, then a body that scrolls once it is taller than the sheet may grow. */
export function SheetContent({ label, header, children }: { label: string; header: ReactNode; children: ReactNode }) {
  const { height } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  return (
    <View accessibilityLabel={label} style={styles.sheet}>
      {/* react-native-screens draws the grabber on iOS only. */}
      {Platform.OS === "android" ? <View style={styles.grabber} /> : null}
      {header}
      {/* A "fitToContents" sheet measures its content, so the body needs a bounded height rather than flex: 1. */}
      <ScrollView
        style={[styles.body, { maxHeight: height * BODY_SHARE }]}
        contentContainerStyle={{ paddingBottom: Math.max(bottom, space[4]) }}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingTop: space[4] },
  body: { flexGrow: 0 },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.surface3, marginBottom: space[2] },
});
