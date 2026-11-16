import { router } from "expo-router";
import { Calendar, Inbox, Mail, PenLine, type LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Avatar } from "@/components/avatar";
import { BotPicker } from "@/components/bot-picker";
import { Chip } from "@/components/chip";
import { Composer } from "@/components/composer";
import { Screen } from "@/components/screen";
import { StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { ChatTopBar } from "@/components/top-bar";
import { botById, host, inbox, user } from "@/sample/world";
import { space } from "@/theme";

const CHIP_ICONS: LucideIcon[] = [Mail, Calendar, Inbox, PenLine];

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomeScreen() {
  const [botId, setBotId] = useState("mausbot");
  const [pickerOpen, setPickerOpen] = useState(false);
  const bot = botById(botId);
  const firstName = user.name.split(" ")[0];
  const unread = inbox.some((row) => row.unread);

  return (
    <Screen
      scroll={false}
      header={<ChatTopBar botName={bot.name} right="inbox" unread={unread} onPressTitle={() => setPickerOpen(true)} />}
      footer={
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {bot.suggestions.map((suggestion, index) => (
              <Chip key={suggestion} label={suggestion} icon={CHIP_ICONS[index % CHIP_ICONS.length]} />
            ))}
          </ScrollView>
          <Composer botName={bot.name} onSend={() => router.navigate({ pathname: "/chat/[id]", params: { id: "lease" } })} />
        </View>
      }
    >
      <View style={styles.empty}>
        <Avatar label={bot.name} tint={bot.tint} />
        <Txt variant="display" style={styles.center}>
          {greeting(new Date().getHours())}, {firstName}
        </Txt>
        <Txt variant="callout" tone="secondary">
          {bot.name} · {bot.role}
        </Txt>
        <View style={styles.hostLine}>
          <StatusDot tone="success" />
          <Txt variant="footnote" tone="secondary">
            {host.name}
          </Txt>
        </View>
      </View>
      <BotPicker visible={pickerOpen} selectedId={botId} onSelect={setBotId} onClose={() => setPickerOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[2], paddingHorizontal: space[6] },
  center: { textAlign: "center", marginTop: space[3] },
  hostLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: space[2] },
  chips: { gap: space[2], paddingHorizontal: space[3], paddingTop: space[2] },
});
