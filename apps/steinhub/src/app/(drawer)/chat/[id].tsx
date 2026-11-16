import { router, useLocalSearchParams } from "expo-router";
import { ChevronRight, ShieldAlert, Wrench } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { Composer } from "@/components/composer";
import { Screen } from "@/components/screen";
import { Badge } from "@/components/status";
import { Txt } from "@/components/text";
import { ChatTopBar } from "@/components/top-bar";
import { botById, leaseMessages, threadById, type SampleBot, type SampleMessage } from "@/sample/world";
import { colors, radius, size, space } from "@/theme";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const thread = threadById(id);
  const bot = botById(thread.botId);
  const messages = thread.id === "lease" ? leaseMessages : [];

  return (
    <Screen
      header={
        <ChatTopBar
          botName={bot.name}
          subtitle={thread.title}
          right="new-chat"
          onPressTitle={() => router.navigate({ pathname: "/bot/[id]", params: { id: bot.id } })}
        />
      }
      footer={<Composer botName={bot.name} />}
    >
      <View style={styles.thread}>
        {messages.length === 0 ? (
          <Txt variant="subhead" tone="tertiary" style={styles.placeholder}>
            Messages in this thread will appear here.
          </Txt>
        ) : (
          messages.map((message) => <Message key={message.id} message={message} bot={bot} />)
        )}
      </View>
    </Screen>
  );
}

function Message({ message, bot }: { message: SampleMessage; bot: SampleBot }) {
  switch (message.from) {
    case "user":
      return (
        <View style={styles.userBubble}>
          <Txt>{message.text}</Txt>
        </View>
      );
    case "bot":
      return (
        <View style={styles.reply}>
          <View style={styles.replyHeader}>
            <Avatar label={bot.name} tint={bot.tint} size="sm" />
            <Txt variant="subhead" weight="600">
              {bot.name}
            </Txt>
            <Txt variant="footnote" tone="tertiary">
              9:40
            </Txt>
          </View>
          {message.tools ? (
            <View style={styles.tools}>
              <Wrench size={16} color={colors.text2} strokeWidth={size.iconStroke} />
              <Txt variant="footnote" tone="secondary">
                Used {message.tools} tools
              </Txt>
              <ChevronRight size={14} color={colors.text3} strokeWidth={size.iconStroke} />
            </View>
          ) : null}
          <Txt>{message.text}</Txt>
        </View>
      );
    case "approval":
      return (
        <View style={styles.approval}>
          <View style={styles.approvalHeader}>
            <View style={styles.approvalBadge}>
              <ShieldAlert size={14} color={colors.warning} strokeWidth={size.iconStroke} />
              <Badge label="Approval needed" tone="warning" />
            </View>
            <Txt variant="caption" tone="tertiary" weight="400">
              {message.action}
            </Txt>
          </View>
          <Txt variant="headline">{message.title}</Txt>
          <View style={styles.preview}>
            <Txt variant="footnote" tone="secondary">
              To {message.to}
            </Txt>
            <Txt variant="footnote" tone="secondary">
              Subject {message.subject}
            </Txt>
            <Txt variant="subhead" numberOfLines={3}>
              {message.preview}
            </Txt>
          </View>
          <View style={styles.actions}>
            <View style={styles.fill}>
              <Button label="Deny" variant="secondary" block />
            </View>
            <View style={styles.fill}>
              <Button label="Approve" block />
            </View>
          </View>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  thread: { paddingHorizontal: space[4], paddingTop: space[4], gap: space[5] },
  placeholder: { textAlign: "center", marginTop: space[12] },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  reply: { gap: space[2] },
  replyHeader: { flexDirection: "row", alignItems: "center", gap: space[2] },
  tools: { flexDirection: "row", alignItems: "center", gap: 6 },
  approval: {
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space[4],
    gap: space[3],
  },
  approvalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  approvalBadge: { flexDirection: "row", alignItems: "center", gap: space[1] },
  preview: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space[3],
    gap: space[1],
  },
  actions: { flexDirection: "row", gap: space[2] },
  fill: { flex: 1 },
});
