import { router, useLocalSearchParams } from "expo-router";
import { Check, ChevronDown, ChevronRight, CornerDownLeft, FileText, Send, ShieldAlert, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from "react-native";
import { attachmentUrlPath, type SentAttachment } from "@/api/attachments";
import { problemText } from "@/api/errors";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { Composer } from "@/components/composer";
import { Markdown } from "@/components/markdown";
import { Screen } from "@/components/screen";
import { Badge, StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { ChatTopBar } from "@/components/top-bar";
import { useConnection } from "@/state/connection";
import { clock, type ApprovalView, type BotView, type HandoffView, type MessageView } from "@/state/views";
import { useWorld } from "@/state/world";
import { colors, radius, size, space } from "@/theme";

type Answer = (card: ApprovalView, option: string) => Promise<void>;

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const world = useWorld();
  const connection = useConnection();
  const { thread, bot, messages, loaded, hasMore } = world.detail(id);
  const [loadFailure, setLoadFailure] = useState<unknown>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const scroller = useRef<ScrollViewInstance>(null);
  const live = world.source === "live";
  const { loadThread } = connection;
  const streaming = messages.some((message) => (message.from === "bot" && message.streaming) || message.from === "working");

  const loadError = loadFailure ? problemText(loadFailure, world.host.name) : null;

  useEffect(() => {
    if (!live || !id) return;
    setLoadFailure(null);
    loadThread(id).catch(setLoadFailure);
  }, [live, id, loadThread]);

  async function send(text: string) {
    if (!bot || !thread) return;
    setSendError(null);
    if (!live) return;
    try {
      await connection.send(bot.id, thread.id, text);
    } catch (error) {
      setSendError(problemText(error, world.host.name));
    }
  }

  const answer: Answer = async (card, option) => {
    if (!live || !thread) return;
    if (!card.requestId) {
      await send(option);
      return;
    }
    const behavior = card.kind === "question" ? "answer" : option === "Deny" ? "deny" : "allow";
    await connection.respond(thread.id, card.requestId, behavior === "answer" ? { behavior, message: option } : { behavior });
  };

  if (!thread || !bot) {
    return (
      <Screen header={<ChatTopBar botName={bot?.name ?? world.host.name} right="new-chat" />}>
        <Txt variant="subhead" tone="tertiary" style={styles.placeholder}>
          {loadError ?? (live && !loaded ? "Loading…" : "This conversation isn't on the computer any more.")}
        </Txt>
      </Screen>
    );
  }

  return (
    <Screen
      scroll={false}
      header={
        <ChatTopBar
          botName={bot.name}
          subtitle={thread.title}
          right="new-chat"
          onPressTitle={() => router.navigate({ pathname: "/bot/[id]", params: { id: bot.id } })}
        />
      }
      footer={
        <View>
          {sendError ? (
            <Txt variant="footnote" style={styles.error}>
              {sendError}
            </Txt>
          ) : null}
          <Composer
            botName={bot.name}
            onSend={send}
            onStop={live && streaming ? () => void connection.stop(bot.id, thread.id).catch(() => undefined) : undefined}
          />
        </View>
      }
    >
      <ScrollView
        ref={scroller}
        style={styles.fill}
        contentContainerStyle={styles.thread}
        keyboardDismissMode="interactive"
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
      >
        {hasMore ? (
          <View style={styles.older}>
            <Button label="Show earlier messages" variant="secondary" small onPress={() => void loadThread(thread.id, { older: true }).catch(setLoadFailure)} />
          </View>
        ) : null}
        {loadError ? (
          <View style={styles.inlineError}>
            <Txt variant="footnote" style={styles.errorText}>
              {loadError}
            </Txt>
            <Button
              label="Try again"
              variant="secondary"
              small
              onPress={() => {
                setLoadFailure(null);
                loadThread(thread.id).catch(setLoadFailure);
              }}
            />
          </View>
        ) : null}
        {messages.length === 0 && !loadError ? (
          <Txt variant="subhead" tone="tertiary" style={styles.placeholder}>
            {live && !loaded ? "Loading…" : "Messages in this thread will appear here."}
          </Txt>
        ) : (
          messages.map((message) => <Message key={message.id} message={message} bot={bot} onAnswer={answer} hostName={world.host.name} findBot={world.bot} />)
        )}
      </ScrollView>
    </Screen>
  );
}

function ReplyHeader({ bot, note, live }: { bot: BotView; note?: string; live?: boolean }) {
  return (
    <View style={styles.replyHeader}>
      <Avatar bot={bot} label={bot.glyph} tint={bot.tint} size="sm" />
      <Txt variant="subhead" weight="600">
        {bot.name}
      </Txt>
      {live ? <StatusDot tone="info" /> : null}
      {note ? (
        <Txt variant="footnote" tone={live ? "secondary" : "tertiary"}>
          {note}
        </Txt>
      ) : null}
    </View>
  );
}

function SentFiles({ files }: { files: SentAttachment[] }) {
  const { attachmentSource } = useConnection();
  return (
    <View style={styles.sentFiles}>
      {files.map((file) => {
        const source = file.kind === "image" ? attachmentSource(attachmentUrlPath(file.path)) : null;
        return source ? (
          <Image key={file.path} accessibilityLabel={file.name} source={source} style={styles.sentImage} />
        ) : (
          <View key={file.path} style={styles.sentFile}>
            <FileText size={16} color={colors.text2} strokeWidth={size.iconStroke} />
            <Txt variant="footnote" numberOfLines={1} style={styles.shrink}>
              {file.name}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

function Handoff({ handoff, teammate }: { handoff: HandoffView; teammate: BotView | null }) {
  const [open, setOpen] = useState(false);
  const Icon = handoff.result ? CornerDownLeft : Send;
  const target = handoff.threadId;
  return (
    <View style={styles.handoff}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={handoff.label}
        disabled={!target}
        onPress={target ? () => router.navigate({ pathname: "/chat/[id]", params: { id: target } }) : undefined}
        style={({ pressed }) => [styles.handoffChip, pressed && styles.pressed]}
      >
        {teammate ? (
          <Avatar bot={teammate} label={teammate.glyph} tint={teammate.tint} size="xs" />
        ) : (
          <Icon size={14} color={handoff.ok ? colors.text2 : colors.danger} strokeWidth={size.iconStroke} />
        )}
        <Txt variant="subhead" numberOfLines={1} style={[styles.handoffLabel, !handoff.ok && styles.errorText]}>
          {handoff.label}
        </Txt>
        {target ? <ChevronRight size={14} color={colors.text3} strokeWidth={size.iconStroke} /> : null}
      </Pressable>
      {handoff.doneWhen ? (
        <Txt variant="footnote" tone="secondary" numberOfLines={1} style={styles.doneWhen}>
          Done when: {handoff.doneWhen}
        </Txt>
      ) : null}
      {handoff.result ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={styles.handoffResult}
        >
          <View style={styles.fill}>
            {open ? (
              <Markdown>{handoff.result}</Markdown>
            ) : (
              <Txt variant="footnote" tone="secondary" numberOfLines={1}>
                {handoff.result.replace(/[*_`#>]/g, "")}
              </Txt>
            )}
          </View>
          {open ? <ChevronDown size={14} color={colors.text3} /> : <ChevronRight size={14} color={colors.text3} />}
        </Pressable>
      ) : null}
    </View>
  );
}

function Message({
  message,
  bot,
  onAnswer,
  hostName,
  findBot,
}: {
  message: MessageView;
  bot: BotView;
  onAnswer: Answer;
  hostName: string;
  findBot: (botId: string | undefined) => BotView | null;
}) {
  switch (message.from) {
    case "user":
      return (
        <View style={[styles.userBubble, message.pending === "sending" && styles.sending]}>
          {message.attachments ? <SentFiles files={message.attachments} /> : null}
          {message.text ? <Txt>{message.text}</Txt> : null}
          {message.pending === "failed" ? (
            <Txt variant="footnote" style={styles.errorText}>
              Not sent.
            </Txt>
          ) : null}
        </View>
      );
    case "working":
      return (
        <View style={styles.reply}>
          <ReplyHeader bot={bot} note="Working" live />
          <ActivityIndicator color={colors.text3} style={styles.spinner} />
        </View>
      );
    case "bot":
      return (
        <View style={styles.reply}>
          <ReplyHeader bot={bot} note={message.streaming ? "Writing" : message.at ? clock(message.at) : "9:40"} live={message.streaming} />
          <Markdown>{message.text}</Markdown>
        </View>
      );
    case "handoff":
      return <Handoff handoff={message} teammate={findBot(message.botId)} />;
    case "approval":
      return <ApprovalCard card={message} onAnswer={onAnswer} hostName={hostName} />;
  }
}

function ApprovalCard({ card, onAnswer, hostName }: { card: ApprovalView; onAnswer: Answer; hostName: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(option: string) {
    setBusy(option);
    setError(null);
    try {
      await onAnswer(card, option);
    } catch (failure) {
      setError(problemText(failure, hostName));
    } finally {
      setBusy(null);
    }
  }

  if (card.state !== "pending") {
    const approved = card.state === "approved" || card.state === "answered";
    const label =
      card.state === "approved" ? "Approved" : card.state === "denied" ? "Denied" : card.state === "answered" ? (card.answer ?? "Answered") : "Closed";
    const Icon = approved ? Check : X;
    return (
      <View style={styles.resolved}>
        <View style={[styles.resolvedMark, { backgroundColor: approved ? colors.successBg : colors.surface2 }]}>
          <Icon size={12} color={approved ? colors.success : colors.text2} strokeWidth={2.5} />
        </View>
        <Txt variant="subhead" numberOfLines={1} tone="secondary" style={styles.fill}>
          <Txt variant="subhead" weight="600">
            {label}
          </Txt>
          {` · ${card.title}`}
        </Txt>
      </View>
    );
  }

  const choices = card.kind === "permission" ? ["Deny", "Approve"] : card.options;
  return (
    <View style={styles.approval}>
      <View style={styles.approvalHeader}>
        <View style={styles.approvalBadge}>
          <ShieldAlert size={14} color={colors.warning} strokeWidth={size.iconStroke} />
          <Badge label={card.kind === "permission" ? "Approval needed" : "Question"} tone="warning" />
        </View>
        <Txt variant="caption" tone="tertiary" weight="400" numberOfLines={1} style={styles.action}>
          {card.action}
        </Txt>
      </View>
      <Txt variant="headline">{card.title}</Txt>
      {card.lines.length || card.preview ? (
        <View style={styles.preview}>
          {card.lines.map((line) => (
            <View key={line.label} style={styles.line}>
              <Txt variant="footnote" tone="tertiary" style={styles.lineLabel}>
                {line.label}
              </Txt>
              <Txt variant="footnote" numberOfLines={1} style={styles.fill}>
                {line.value}
              </Txt>
            </View>
          ))}
          {card.preview ? (
            <Txt variant="footnote" tone="secondary" numberOfLines={6} style={card.lines.length ? styles.previewText : undefined}>
              {card.preview}
            </Txt>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Txt variant="footnote" style={styles.errorText}>
          {error}
        </Txt>
      ) : null}
      <View style={[styles.actions, choices.length > 2 && styles.actionsWrap]}>
        {choices.map((option) => (
          <View key={option} style={choices.length > 2 ? styles.wide : styles.fill}>
            <Button
              label={busy === option ? `${option}…` : option}
              variant={option === "Approve" || (card.kind === "question" && option === choices[0]) ? "primary" : "secondary"}
              block
              disabled={busy !== null}
              onPress={() => void choose(option)}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  thread: { paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[4], gap: space[5] },
  placeholder: { textAlign: "center", marginTop: space[12] },
  older: { alignItems: "center" },
  inlineError: { gap: space[2], alignItems: "flex-start" },
  error: { color: colors.danger, paddingHorizontal: space[4], paddingTop: space[2] },
  errorText: { color: colors.danger },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sending: { opacity: 0.6 },
  sentFiles: { gap: space[2], marginBottom: space[1] },
  sentImage: { width: 200, height: 150, borderRadius: radius.md, backgroundColor: colors.surface3 },
  sentFile: { flexDirection: "row", alignItems: "center", gap: space[2], maxWidth: 240 },
  shrink: { flexShrink: 1 },
  reply: { gap: space[2] },
  replyHeader: { flexDirection: "row", alignItems: "center", gap: space[2] },
  handoff: { alignItems: "flex-start", gap: space[1] },
  handoffChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    height: 34,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  handoffLabel: { flexShrink: 1 },
  pressed: { backgroundColor: colors.surface1 },
  doneWhen: { paddingHorizontal: space[3], maxWidth: "100%" },
  handoffResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    alignSelf: "stretch",
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  spinner: { alignSelf: "flex-start" },
  approval: {
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    padding: space[4],
    gap: space[3],
  },
  line: { flexDirection: "row", gap: space[2] },
  lineLabel: { width: 52 },
  previewText: { marginTop: space[2] },
  approvalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  approvalBadge: { flexDirection: "row", alignItems: "center", gap: space[1] },
  action: { flexShrink: 1 },
  preview: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space[3],
    gap: space[1],
  },
  actions: { flexDirection: "row", gap: space[2] },
  actionsWrap: { flexWrap: "wrap" },
  wide: { width: "100%" },
  resolved: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 44,
    paddingLeft: space[3],
    paddingRight: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resolvedMark: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
