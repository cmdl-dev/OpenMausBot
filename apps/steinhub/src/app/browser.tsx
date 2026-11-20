import { router, useLocalSearchParams } from "expo-router";
import { Keyboard as KeyboardIcon, LockKeyhole, RotateCw } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, TextInput, View, type TextInputInstance } from "react-native";
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from "react-native-gesture-handler";
import { problemText } from "@/api/errors";
import { Button } from "@/components/button";
import { IconButton } from "@/components/icon-button";
import { Screen } from "@/components/screen";
import { Txt } from "@/components/text";
import { PageTopBar } from "@/components/top-bar";
import { blankPage, NO_ZOOM, pagePoint, useBrowserView, zoomAt, type Size, type Zoom } from "@/state/browser-view";
import { useConnection } from "@/state/connection";
import { useWorld } from "@/state/world";
import { colors, radius, space } from "@/theme";

const MAX_ZOOM = 4;

/**
 * A bot's browser, live. Watching costs nothing; Take control lets this phone's taps, scrolls and typing reach the page,
 * and Give back returns it to the bot. Opened from a sign-in card (`card`), it starts in the person's control on the
 * site to sign in to, and Give back answers the card, so the bot hears the person finished and carries on.
 */
export default function BrowserScreen() {
  const { bot: botId, thread: threadId, card } = useLocalSearchParams<{ bot: string; thread: string; card?: string }>();
  const world = useWorld();
  const connection = useConnection();
  const bot = world.bot(botId);
  const signIn = card ? world.detail(threadId).messages.find((message) => message.from === "signin" && message.messageId === card) : undefined;
  const waitingSignIn = signIn?.from === "signin" && signIn.state === "waiting" ? signIn : null;
  const { browser } = connection;
  const link = useMemo(() => browser(botId, threadId), [browser, botId, threadId]);
  const { state, act, reconnect, dismissProblem } = useBrowserView(link, world.host.name);
  const [answering, setAnswering] = useState<"done" | "cancel" | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const keys = useRef<TextInputInstance>(null);
  const controlling = state.control?.controlling === true;
  const botName = bot?.name ?? "The bot";

  const tookForSignIn = useRef(false);
  useEffect(() => {
    if (!waitingSignIn || tookForSignIn.current || state.phase !== "showing" || !state.control || state.control.controlling) return;
    if (state.control.held && !state.control.owned) return;
    tookForSignIn.current = true;
    void act({ type: "take" });
  }, [waitingSignIn, state.phase, state.control, act]);

  const openedSite = useRef(false);
  useEffect(() => {
    if (!waitingSignIn || openedSite.current || !controlling || !state.frame || !blankPage(state.url)) return;
    openedSite.current = true;
    void act({ type: "navigate", url: waitingSignIn.url });
  }, [waitingSignIn, controlling, state.frame, state.url, act]);

  async function answer(outcome: "done" | "cancel") {
    if (!waitingSignIn || answering) return;
    setAnswering(outcome);
    setAnswerError(null);
    try {
      await connection.answerSignIn(waitingSignIn.botId ?? botId, threadId, waitingSignIn.messageId, outcome);
      close();
    } catch (error) {
      setAnswerError(problemText(error, world.host.name));
    } finally {
      setAnswering(null);
    }
  }

  function giveBack() {
    keys.current?.blur();
    if (waitingSignIn) void answer("done");
    else void act({ type: "release" });
  }

  const title = waitingSignIn ? `Sign in to ${waitingSignIn.site}` : `${botName}'s browser`;
  const problem = answerError ?? state.problem;

  return (
    <Screen
      scroll={false}
      header={<PageTopBar leading="back" title={title} />}
      footer={
        <View style={styles.footer}>
          {problem ? (
            <Txt variant="footnote" style={styles.error} onPress={answerError ? () => setAnswerError(null) : dismissProblem}>
              {problem}
            </Txt>
          ) : null}
          <Controls
            phase={state.phase}
            control={state.control}
            botName={botName}
            signIn={waitingSignIn !== null}
            answering={answering}
            onTake={() => void act({ type: "take" })}
            onGiveBack={giveBack}
            onCancel={() => void answer("cancel")}
            onKeyboard={() => keys.current?.focus()}
            onReconnect={reconnect}
            asleep={state.asleep}
          />
        </View>
      }
    >
      {waitingSignIn ? (
        <View style={styles.banner}>
          <LockKeyhole size={14} color={colors.text2} />
          <Txt variant="footnote" tone="secondary" style={styles.fill}>
            Type the password into the page yourself. {botName} never sees it. Tap Give back when you're signed in.
          </Txt>
        </View>
      ) : null}
      <View style={styles.page}>
        {link ? (
          <Page frame={state.frame} controlling={controlling} act={act} />
        ) : (
          <Txt variant="subhead" tone="tertiary" style={styles.note}>
            Pair a computer to see {botName}'s browser.
          </Txt>
        )}
        {link && !state.frame && state.phase !== "ended" ? <ActivityIndicator color={colors.text3} style={StyleSheet.absoluteFill} /> : null}
      </View>
      <TextInput
        ref={keys}
        value={KEEP}
        selection={{ start: KEEP.length, end: KEEP.length }}
        accessibilityLabel="Type into the page"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        submitBehavior="submit"
        style={styles.keys}
        onChangeText={(text) => {
          if (!text.includes(KEEP)) {
            void pressKey(act, "Backspace", 8);
            return;
          }
          const typed = text.replace(KEEP, "");
          if (typed) void act({ type: "input_keyboard", eventType: "char", text: typed });
        }}
        onSubmitEditing={() => void pressKey(act, "Enter", 13, "\r")}
      />
    </Screen>
  );

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: "/chat/[id]", params: { id: threadId } });
  }
}

type Act = ReturnType<typeof useBrowserView>["act"];

/** What the typing field always holds, so deleting it is a Backspace on any keyboard: React Native 0.88 reports no key
 * press from a hardware keyboard on Android. */
const KEEP = "\u200b";

async function pressKey(act: Act, key: string, keyCode: number, text?: string) {
  await act({ type: "input_keyboard", eventType: "keyDown", key, code: key, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
  await act({ type: "input_keyboard", eventType: "keyUp", key, code: key, windowsVirtualKeyCode: keyCode });
}

/** The page, fitted to the screen: pinch to zoom in, two fingers to move around. While in control, a tap clicks and one finger scrolls the page. */
function Page({ frame, controlling, act }: { frame: { uri: string; page: Size } | null; controlling: boolean; act: Act }) {
  const [area, setArea] = useState<Size | null>(null);
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const pinchStart = useRef(NO_ZOOM);
  const scroll = useRef({ x: 0, y: 0, dx: 0, dy: 0, sending: false });

  const drawn = area && frame ? fit(frame.page, area) : null;
  const offset = area && drawn ? { x: (area.width - drawn.width) / 2, y: (area.height - drawn.height) / 2 } : { x: 0, y: 0 };

  function bounded(next: Zoom): Zoom {
    if (!drawn) return NO_ZOOM;
    const scale = Math.min(Math.max(next.scale, 1), MAX_ZOOM);
    const limitX = (drawn.width * (scale - 1)) / 2;
    const limitY = (drawn.height * (scale - 1)) / 2;
    return { scale, x: Math.min(Math.max(next.x, -limitX), limitX), y: Math.min(Math.max(next.y, -limitY), limitY) };
  }
  const shown = bounded(zoom);

  function onPage(touch: { x: number; y: number }) {
    if (!frame || !drawn) return null;
    return pagePoint({ x: touch.x - offset.x, y: touch.y - offset.y }, drawn, frame.page, shown);
  }

  async function flushScroll() {
    const pending = scroll.current;
    if (pending.sending || (!pending.dx && !pending.dy)) return;
    const { x, y, dx, dy } = pending;
    pending.dx = 0;
    pending.dy = 0;
    pending.sending = true;
    await act({ type: "input_mouse", eventType: "mouseWheel", x, y, deltaX: dx, deltaY: dy });
    pending.sending = false;
    void flushScroll();
  }

  const tap = useTapGesture({
    enabled: controlling,
    runOnJS: true,
    onActivate: (event) => {
      const point = onPage(event);
      if (!point) return;
      void act({ type: "input_mouse", eventType: "mouseMoved", ...point });
      void act({ type: "input_mouse", eventType: "mousePressed", ...point, button: "left", clickCount: 1 });
      void act({ type: "input_mouse", eventType: "mouseReleased", ...point, button: "left", clickCount: 1 });
    },
  });

  const scrollPage = usePanGesture({
    enabled: controlling,
    maxPointers: 1,
    runOnJS: true,
    onUpdate: (event) => {
      const point = onPage(event);
      if (!point || !frame || !drawn) return;
      const perPoint = frame.page.width / drawn.width / shown.scale;
      Object.assign(scroll.current, point);
      scroll.current.dx -= event.changeX * perPoint;
      scroll.current.dy -= event.changeY * perPoint;
      void flushScroll();
    },
  });

  const pinch = usePinchGesture({
    runOnJS: true,
    onBegin: () => {
      pinchStart.current = shown;
    },
    onUpdate: (event) => {
      if (!area) return;
      const focal = { x: event.focalX - area.width / 2, y: event.focalY - area.height / 2 };
      setZoom(bounded(zoomAt(pinchStart.current, pinchStart.current.scale * event.scale, focal)));
    },
  });

  const move = usePanGesture({
    minPointers: 2,
    runOnJS: true,
    onUpdate: (event) => setZoom((current) => {
      const from = bounded(current);
      return bounded({ ...from, x: from.x + event.changeX, y: from.y + event.changeY });
    }),
  });

  const gestures = useSimultaneousGestures(tap, scrollPage, pinch, move);

  return (
    <GestureDetector gesture={gestures}>
      <View style={styles.fill} onLayout={({ nativeEvent: { layout } }) => setArea({ width: layout.width, height: layout.height })}>
        {frame && drawn ? (
          <View style={[styles.frame, { left: offset.x, top: offset.y, width: drawn.width, height: drawn.height, transform: [{ translateX: shown.x }, { translateY: shown.y }, { scale: shown.scale }] }]}>
            <Image source={{ uri: frame.uri }} style={styles.fill} fadeDuration={0} accessibilityLabel="The bot's browser" />
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

function fit(page: Size, area: Size): Size {
  const scale = Math.min(area.width / page.width, area.height / page.height);
  return { width: page.width * scale, height: page.height * scale };
}

function Controls({
  phase,
  control,
  botName,
  signIn,
  answering,
  asleep,
  onTake,
  onGiveBack,
  onCancel,
  onKeyboard,
  onReconnect,
}: {
  phase: string;
  control: { held: boolean; owned: boolean; controlling: boolean } | null;
  botName: string;
  signIn: boolean;
  answering: "done" | "cancel" | null;
  asleep: boolean;
  onTake: () => void;
  onGiveBack: () => void;
  onCancel: () => void;
  onKeyboard: () => void;
  onReconnect: () => void;
}) {
  if (phase === "ended") {
    return (
      <View style={styles.controls}>
        <Txt variant="subhead" tone="secondary" style={styles.fill}>
          {asleep ? "The browser closed to save memory." : "The browser view closed."}
        </Txt>
        <Button label={asleep ? "Open it again" : "Reconnect"} icon={RotateCw} small onPress={onReconnect} />
      </View>
    );
  }
  if (!control) {
    return (
      <View style={styles.controls}>
        <Txt variant="subhead" tone="secondary">
          {phase === "waiting" ? "Waiting for the browser…" : "Connecting…"}
        </Txt>
      </View>
    );
  }
  if (control.controlling) {
    return (
      <View style={styles.controls}>
        <IconButton icon={KeyboardIcon} label="Type" onPress={onKeyboard} />
        <View style={styles.fill} />
        {signIn ? <Button label={answering === "cancel" ? "Cancelling…" : "Cancel"} variant="ghost" small disabled={answering !== null} onPress={onCancel} /> : null}
        <Button label={answering === "done" ? "Giving back…" : "Give back"} small disabled={answering !== null} onPress={onGiveBack} />
      </View>
    );
  }
  const someoneElse = control.held && !control.owned;
  return (
    <View style={styles.controls}>
      <Txt variant="subhead" tone="secondary" style={styles.fill}>
        {someoneElse ? "Someone else is using this browser." : control.owned ? "You're using it on another device." : `${botName} has the browser.`}
      </Txt>
      {someoneElse ? null : <Button label="Take control" small onPress={onTake} />}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { flex: 1, backgroundColor: colors.viewer, overflow: "hidden" },
  frame: { position: "absolute" },
  note: { textAlign: "center", marginTop: space[12], paddingHorizontal: space[6] },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    marginHorizontal: space[4],
    marginBottom: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
  },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  controls: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[4], paddingVertical: space[2], minHeight: 56 },
  error: { color: colors.danger, paddingHorizontal: space[4], paddingTop: space[2] },
  keys: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
