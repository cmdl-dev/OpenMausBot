import { Drawer } from "expo-router/drawer";
import { AppDrawer } from "@/components/app-drawer";
import { colors } from "@/theme";

export const unstable_settings = {
  anchor: "index",
};

export default function DrawerLayout() {
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
      <Drawer.Screen name="settings" options={{ title: "Settings" }} />
    </Drawer>
  );
}
