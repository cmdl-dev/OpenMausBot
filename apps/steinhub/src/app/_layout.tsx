import { DarkTheme, Stack, ThemeProvider, type Theme } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { sheetScreenOptions } from "@/components/sheet";
import { ConnectionProvider } from "@/state/connection";
import { useOpenChiefOnLaunch } from "@/state/launch";
import { colors } from "@/theme";

const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bgRaised,
    border: colors.border,
    text: colors.text,
    primary: colors.text,
    notification: colors.danger,
  },
};

export const unstable_settings = {
  anchor: "(drawer)",
};

function OpenChiefOnLaunch() {
  useOpenChiefOnLaunch();
  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <ConnectionProvider>
        <ThemeProvider value={navigationTheme}>
          <StatusBar style="light" />
          <OpenChiefOnLaunch />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="(drawer)" />
            <Stack.Screen name="onboarding" options={{ presentation: "fullScreenModal" }} />
            <Stack.Screen name="sheets/bot-picker" options={sheetScreenOptions} />
            <Stack.Screen name="sheets/bot-menu" options={sheetScreenOptions} />
            <Stack.Screen name="sheets/new-folder" options={sheetScreenOptions} />
            <Stack.Screen name="sheets/model" options={sheetScreenOptions} />
          </Stack>
        </ThemeProvider>
      </ConnectionProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
