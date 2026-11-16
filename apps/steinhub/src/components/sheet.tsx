import { useEffect, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { Animated, Easing, Gesture, GestureDetector, interpolate, scheduleOnRN, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "@/components/motion";
import { colors, motion, radius, shadowSheet, space } from "@/theme";

/** A drag this far down, or a flick this fast, closes the sheet; anything less springs it back. */
const CLOSE_FRACTION = 0.25;
const CLOSE_VELOCITY = 900;
/** How much an upward drag moves the sheet: a little, so it feels attached rather than stuck. */
const UPWARD_RESISTANCE = 0.12;
const SETTLE = { damping: 32, stiffness: 380, mass: 0.9 } as const;
const OPEN_MS = 300;
const CLOSE_MS = 220;

export interface SheetProps {
  open: boolean;
  /** Called once the sheet should go: a tap on the scrim, a drag or flick down, or the system back. */
  onClose: () => void;
  label: string;
  /** The top of the sheet, under the grabber: dragging it moves the sheet. */
  children: ReactNode;
  /** A scrolling list under it, which scrolls instead of dragging the sheet. */
  scrolling?: ReactNode;
  /** Lifts the sheet above the keyboard, for a sheet with a text field. */
  avoidKeyboard?: boolean;
}

/** The bottom sheet every menu uses: it slides up over a fading scrim and follows a finger down to close. */
export function Sheet({ open, onClose, label, children, scrolling, avoidKeyboard }: SheetProps) {
  const { height: screen } = useWindowDimensions();
  const [mounted, setMounted] = useState(open);
  const [sheetHeight, setSheetHeight] = useState(0);
  const offset = useSharedValue(screen);
  const travel = useSharedValue(screen);
  // What the sheet showed when it was last open, so it doesn't go blank while it slides away.
  const shown = useRef({ children, scrolling });
  if (open) shown.current = { children, scrolling };

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    offset.value = withTiming(travel.value, { duration: CLOSE_MS, easing: Easing.bezier(...motion.easing) }, (done) => {
      if (done) scheduleOnRN(setMounted, false);
    });
  }, [open, mounted, offset, travel]);

  useEffect(() => {
    if (!open || !mounted || sheetHeight === 0) return;
    travel.value = sheetHeight;
    offset.value = sheetHeight;
    offset.value = withTiming(0, { duration: OPEN_MS, easing: Easing.bezier(...motion.easing) });
  }, [open, mounted, sheetHeight, offset, travel]);

  const drag = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .failOffsetX([-24, 24])
    .onUpdate((event) => {
      offset.value = event.translationY >= 0 ? event.translationY : event.translationY * UPWARD_RESISTANCE;
    })
    .onEnd((event) => {
      const closing = offset.value > travel.value * CLOSE_FRACTION || event.velocityY > CLOSE_VELOCITY;
      if (closing) {
        const remaining = Math.max(0, travel.value - offset.value);
        const duration = Math.min(CLOSE_MS, Math.max(90, (remaining / Math.max(event.velocityY, 1)) * 1000));
        offset.value = withTiming(travel.value, { duration, easing: Easing.out(Easing.quad) }, (done) => {
          if (done) scheduleOnRN(onClose);
        });
      } else {
        offset.value = withSpring(0, { ...SETTLE, velocity: event.velocityY });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(offset.value, -24) }] }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(offset.value, [0, Math.max(travel.value, 1)], [1, 0], "clamp"),
  }));

  if (!mounted) return null;
  const body = (
    <Animated.View
      accessibilityViewIsModal
      accessibilityLabel={label}
      onLayout={(event) => setSheetHeight(Math.ceil(event.nativeEvent.layout.height))}
      style={[styles.sheet, sheetStyle]}
    >
      <SafeAreaView edges={["bottom"]}>
        <GestureDetector gesture={drag}>
          <View>
            <View style={styles.grabber} />
            {shown.current.children}
          </View>
        </GestureDetector>
        {shown.current.scrolling}
      </SafeAreaView>
    </Animated.View>
  );
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
          <Pressable accessibilityLabel="Close" style={styles.fill} onPress={onClose} />
        </Animated.View>
        {avoidKeyboard ? (
          <KeyboardAvoidingView pointerEvents="box-none" style={styles.anchor} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            {body}
          </KeyboardAvoidingView>
        ) : (
          <View pointerEvents="box-none" style={styles.anchor}>
            {body}
          </View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { backgroundColor: colors.scrim },
  anchor: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.bgRaised,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: colors.border,
    ...shadowSheet,
  },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.surface3, marginTop: space[2], marginBottom: space[1] },
});
