import { router, useLocalSearchParams } from "expo-router";
import { ArrowDown, Bell, Check, ChevronDown, ChevronRight, CornerDownLeft, FileText, Send, ShieldAlert, X } from "lucide-react-native";
import type { WidgetValues } from "@openmausbot/phone-protocol/widget.ts";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from "react-native";
import { attachmentUrlPath, type SentAttachment } from "@/api/attachments";
import { problemText } from "@/api/errors";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { IconButton } from "@/components/icon-button";
import { Composer } from "@/components/composer";
import { WidgetCard } from "@/components/widget";
import { Markdown } from "@/components/markdown";
import { Screen } from "@/components/screen";
import { SignInCard } from "@/components/sign-in-card";
import { Badge, StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { ChatTopBar } from "@/components/top-bar";
import { useConnection } from "@/state/connection";
import { clock, type ApprovalView, type BotView, type HandoffView, type MessageView, type WidgetView } from "@/state/views";
import { useWorld } from "@/state/world";
import { colors, radius, size, space } from "@/theme";

type Answer = (card: ApprovalView, option: string) => Promise<void>;
type Press = (widget: WidgetView, press: { ref: string; values?: WidgetValues }) => Promise<void>;

export default function ChatScreen() {
  const { id, message: target } = useLocalSearchParams<{ id: string; message?: string }>();
  return <Thread key={id} id={id} target={target} />;
}

function Thread({ id, target }: { id: string; target?: string }) {
  const world = useWorld();
  const connection = useConnection();
  const { thread, bot, messages, loaded, hasMore } = world.detail(id);
  const [loadFailure, setLoadFailure] = useState<unknown>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const scroller = useRef<ScrollViewInstance>(null);
  const following = useRef(true);
  const [scrolledUp, setScrolledUp] = useState(false);
  const live = world.source === "live";
  const { loadThread } = connection;
  const offsets = useRef(new Map<string, number>());
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const reached = useRef<string | null>(null);
  const olderTries = useRef(0);
  const targetView = target ? messages.find((message) => message.from === "bot" && message.messageId === target) : undefined;
  const streaming = messages.some((message) => (message.from === "bot" && message.streaming) || message.from === "working");

  const loadError = loadFailure ? problemText(loadFailure, world.host.name) : null;

  function onScroll({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }: NativeSyntheticEvent<NativeScrollEvent>) {
    following.current = contentSize.height - contentOffset.y - layoutMeasurement.height < NEAR_BOTTOM;
    setScrolledUp(!following.current);
  }

  function toBottom() {
    following.current = true;
    setScrolledUp(false);
    scroller.current?.scrollToEnd({ animated: true });
  }

  useEffect(() => {
    if (!target || reached.current === target || !loaded) return;
    if (targetView) return;
    if (hasMore && olderTries.current < OLDER_PAGES_FOR_TARGET) {
      olderTries.current += 1;
      loadThread(id, { older: true }).catch(() => undefined);
    }
  }, [target, targetView, loaded, hasMore, id, loadThread]);

  function reveal(viewId: string, y: number) {
    offsets.current.set(viewId, y);
    if (!target || reached.current === target || targetView?.id !== viewId) return;
    reached.current = target;
    following.current = false;
    setScrolledUp(true);
    setHighlighted(viewId);
    setTimeout(() => scroller.current?.scrollTo({ y: Math.max(0, y - space[4]), animated: true }), 50);
    setTimeout(() => setHighlighted((current) => (current === viewId ? null : current)), HIGHLIGHT_MS);
  }

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

  const press: Press = async (widget, { ref, values }) => {
    if (!live || !bot || !thread) return;
    await connection.pressWidget(bot.id, thread.id, { messageId: widget.messageId, ref, rev: widget.widget.rev ?? 0, ...(values ? { values } : {}) });
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
      <View style={styles.fill}>
        <ScrollView
          ref={scroller}
          testID="thread"
          style={styles.fill}
          contentContainerStyle={styles.thread}
          keyboardDismissMode="interactive"
          scrollEventThrottle={64}
          onScroll={onScroll}
          onContentSizeChange={() => {
            if (following.current && !(target && reached.current !== target)) scroller.current?.scrollToEnd({ animated: false });
          }}
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
            messages.map((message) => (
              <View
                key={message.id}
                onLayout={(event) => reveal(message.id, event.nativeEvent.layout.y)}
                style={highlighted === message.id ? styles.highlight : undefined}
                accessibilityState={highlighted === message.id ? { selected: true } : undefined}
              >
                <Message message={message} bot={bot} threadId={thread.id} onAnswer={answer} onPress={press} hostName={world.host.name} findBot={world.bot} />
              </View>
            ))
          )}
        </ScrollView>
        {scrolledUp ? (
          <View style={styles.toBottom}>
            <IconButton icon={ArrowDown} label="Scroll to the latest message" dimension={40} filled onPress={toBottom} />
          </View>
        ) : null}
      </View>
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

function openImage(file: SentAttachment) {
  router.push({ pathname: "/image", params: { path: attachmentUrlPath(file.path), name: file.name } });
}

function SentFiles({ files }: { files: SentAttachment[] }) {
  const { attachmentSource } = useConnection();
  return (
    <View style={styles.sentFiles}>
      {files.map((file) => {
        const source = file.kind === "image" ? attachmentSource(attachmentUrlPath(file.path)) : null;
        return source ? (
          <Pressable key={file.path} accessibilityRole="imagebutton" accessibilityLabel={`Open ${file.name}`} onPress={() => openImage(file)}>
            <Image source={source} style={styles.sentImage} />
          </Pressable>
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
  threadId,
  onAnswer,
  onPress,
  hostName,
  findBot,
}: {
  message: MessageView;
  bot: BotView;
  threadId: string;
  onAnswer: Answer;
  onPress: Press;
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
        <BotReply message={message} bot={bot} />
      );
    case "handoff":
      return <Handoff handoff={message} teammate={findBot(message.botId)} />;
    case "signin":
      return <SignInCard card={message} botId={bot.id} botName={(message.botId && findBot(message.botId)?.name) || bot.name} threadId={threadId} hostName={hostName} />;
    case "approval":
      return <ApprovalCard card={message} onAnswer={onAnswer} hostName={hostName} />;
    case "widget":
      return (
        <View style={styles.reply}>
          <ReplyHeader bot={bot} note={message.at ? clock(message.at) : undefined} />
          <WidgetCard
            key={`${message.messageId}:${message.widget.rev ?? 0}`}
            payload={message.widget}
            hostName={hostName}
            onPress={(widgetPress) => onPress(message, widgetPress)}
          />
        </View>
      );
  }
}

function BotReply({ message, bot }: { message: Extract<MessageView, { from: "bot" }>; bot: BotView }) {
  const [streamed] = useState(Boolean(message.streaming));
  return (
    <View style={styles.reply}>
      <ReplyHeader bot={bot} note={message.streaming ? "Writing" : message.at ? clock(message.at) : "9:40"} live={message.streaming} />
      {message.alert ? (
        <View style={styles.alert} accessibilityLabel={`Notified you: ${message.alert.title}`}>
          <Bell size={14} color={colors.warning} strokeWidth={size.iconStroke} />
          <Txt variant="footnote" weight="600" style={styles.alertText} numberOfLines={2}>
            {message.alert.title}
          </Txt>
        </View>
      ) : null}
      {message.text ? <Markdown fadesIn={streamed}>{message.text}</Markdown> : null}
      {message.images ? <SentFiles files={message.images} /> : null}
      {message.text || message.images ? null : <ActivityIndicator color={colors.text3} style={styles.spinner} />}
    </View>
  );
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

/** How close to the end still counts as reading the latest message, so new text keeps it in view. */
const NEAR_BOTTOM = 80;
/** How many earlier pages a notification's message is looked for in before the chat settles for the latest. */
const OLDER_PAGES_FOR_TARGET = 5;
const HIGHLIGHT_MS = 2_500;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  toBottom: {
    position: "absolute",
    bottom: space[3],
    alignSelf: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
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
  highlight: { backgroundColor: colors.warningBg, borderRadius: radius.md },
  alert: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space[1],
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningBg,
  },
  alertText: { color: colors.warning, flexShrink: 1 },
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
