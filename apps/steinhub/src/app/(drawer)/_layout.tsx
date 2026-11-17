import { Redirect } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { StyleSheet, View } from "react-native";
import { AppDrawer } from "@/components/app-drawer";
import { useConnection } from "@/state/connection";
import { colors } from "@/theme";

export default function DrawerLayout() {
  const { mode } = useConnection();
  if (mode === "loading") return <View style={styles.loading} />;
  if (mode === "unpaired") return <Redirect href="/onboarding" />;
  return (
    <Drawer
      backBehavior="history"
      drawerContent={(props) => <AppDrawer {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: "front",
        drawerStyle: { width: "85%", backgroundColor: colors.bgRaised },
        overlayColor: colors.scrim,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Drawer.Screen name="index" options={{ title: "New chat" }} />
      <Drawer.Screen name="chat/[id]" options={{ title: "Chat" }} />
      <Drawer.Screen name="bot/[id]" options={{ title: "Bot" }} />
      <Drawer.Screen name="inbox" options={{ title: "Inbox" }} />
      <Drawer.Screen name="automations/index" options={{ title: "Automations" }} />
      <Drawer.Screen name="automations/[id]" options={{ title: "Automation" }} />
      <Drawer.Screen name="computers" options={{ title: "Computers" }} />
      <Drawer.Screen name="apps" options={{ title: "Apps" }} />
      <Drawer.Screen name="settings" options={{ title: "Settings" }} />
      <Drawer.Screen name="vault/index" options={{ title: "Vault" }} />
      <Drawer.Screen name="vault/add" options={{ title: "Add to Vault" }} />
    </Drawer>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.bg },
});
