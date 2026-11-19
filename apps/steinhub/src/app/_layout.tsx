import { reloadAppAsync } from "expo";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type Theme } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Appearance, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppLock } from "@/components/app-lock";
import { sheetScreenOptions } from "@/components/sheet";
import { ConnectionProvider } from "@/state/connection";
import { useOpenChiefOnLaunch } from "@/state/launch";
import { startup } from "@/state/preferences";
import { PushProvider } from "@/state/push";
import { colors, scheme } from "@/theme";

const base = scheme === "light" ? DefaultTheme : DarkTheme;
const navigationTheme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    background: colors.bg,
    card: colors.bgRaised,
    border: colors.border,
    text: colors.text,
    primary: colors.text,
    notification: colors.danger,
  },
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export const unstable_settings = {
  anchor: "(drawer)",
};

/** "System" redraws when the phone's appearance changes, since every style is built once at start. */
function FollowTheme() {
  useEffect(() => {
    if (startup.theme !== "system") return;
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      if ((colorScheme === "light" ? "light" : "dark") !== scheme) void reloadAppAsync();
    });
    return () => subscription.remove();
  }, []);
  return null;
}

function OpenChiefOnLaunch() {
  useOpenChiefOnLaunch();
  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <ConnectionProvider>
        <PushProvider>
          <ThemeProvider value={navigationTheme}>
            <StatusBar style={scheme === "light" ? "dark" : "light"} />
            <FollowTheme />
            <OpenChiefOnLaunch />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
              <Stack.Screen name="(drawer)" />
              <Stack.Screen name="onboarding" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="image" options={{ presentation: "fullScreenModal", animation: "fade", contentStyle: { backgroundColor: colors.viewer } }} />
              <Stack.Screen name="sheets/bot-picker" options={sheetScreenOptions} />
              <Stack.Screen name="sheets/bot-menu" options={sheetScreenOptions} />
              <Stack.Screen name="sheets/new-folder" options={sheetScreenOptions} />
              <Stack.Screen name="sheets/model" options={sheetScreenOptions} />
              <Stack.Screen name="sheets/vault-add" options={sheetScreenOptions} />
              <Stack.Screen name="sheets/vault-item" options={sheetScreenOptions} />
              <Stack.Screen name="sheets/theme" options={sheetScreenOptions} />
              <Stack.Screen name="sheets/text-size" options={sheetScreenOptions} />
              <Stack.Screen name="sheets/default-bot" options={sheetScreenOptions} />
              <Stack.Screen name="sheets/quiet-time" options={sheetScreenOptions} />
            </Stack>
            <AppLock />
          </ThemeProvider>
        </PushProvider>
      </ConnectionProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
