import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinkBanner } from "@/components/notice";
import { colors, space } from "@/theme";

export interface ScreenProps {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  /** Pull to refresh: what it calls, and whether a refresh is under way. */
  refresh?: { refreshing: boolean; onRefresh: () => void };
}

export function Screen({ header, footer, children, scroll = true, refresh }: ScreenProps) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {header}
        <LinkBanner />
        {scroll ? (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.content}
            keyboardDismissMode="interactive"
            refreshControl={refresh ? <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} tintColor={colors.text2} /> : undefined}
          >
            {children}
          </ScrollView>
        ) : (
          children
        )}
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  content: { paddingBottom: space[8] },
});
