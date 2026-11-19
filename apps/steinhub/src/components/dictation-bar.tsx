import { useSpeechRecognitionEvent } from "expo-speech-recognition";
import { Check, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from "react-native";
import { IconButton } from "@/components/icon-button";
import { Txt } from "@/components/text";
import { colors, radius, size, space, type } from "@/theme";

const BAR_WIDTH = 3;
const BAR_GAP = 4;
const BAR_MIN = 3;
const BAR_MAX = 28;
const LEVELS_KEPT = 120;
const TRANSCRIPT_LINES = 4;

/** expo-speech-recognition reports volume from -2 to 10, and anything at or below 0 is silence. */
export function levelFromVolume(value: number): number {
  return Math.sqrt(Math.min(Math.max(value / 10, 0), 1));
}

export function elapsedLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Stands in for the composer while the phone listens: what has been heard so far, a waveform of the voice, and
 * Cancel and Done. */
export function DictationBar({ transcript, finishing, onCancel, onDone }: { transcript: string; finishing: boolean; onCancel: () => void; onDone: () => void }) {
  const [levels, setLevels] = useState<number[]>([]);
  const [seconds, setSeconds] = useState(0);
  const scroller = useRef<ScrollViewInstance>(null);

  useSpeechRecognitionEvent("volumechange", (event) => {
    setLevels((current) => [...current.slice(-(LEVELS_KEPT - 1)), levelFromVolume(event.value)]);
  });

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.bar}>
      <ScrollView ref={scroller} style={styles.transcript} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}>
        <Txt variant="callout" tone={transcript ? "primary" : "tertiary"} accessibilityLiveRegion="polite">
          {transcript || "Listening…"}
        </Txt>
      </ScrollView>
      <View style={styles.controls}>
        <IconButton icon={X} label="Cancel dictation" dimension={40} color={colors.text} onPress={onCancel} />
        <Waveform levels={levels} />
        <Txt variant="callout" tone="secondary" style={styles.time} accessibilityLabel={`Listening for ${seconds} seconds`}>
          {elapsedLabel(seconds)}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done dictating"
          accessibilityState={{ busy: finishing }}
          disabled={finishing}
          onPress={onDone}
          style={({ pressed }) => [styles.done, pressed && styles.donePressed]}
        >
          {finishing ? <ActivityIndicator size="small" color={colors.text} /> : <Check size={size.icon} color={colors.text} strokeWidth={2.4} />}
        </Pressable>
      </View>
    </View>
  );
}

/** The newest level is on the right; older ones move left as new ones arrive. */
function Waveform({ levels }: { levels: number[] }) {
  const [count, setCount] = useState(0);
  return (
    <View
      style={styles.wave}
      onLayout={(event) => setCount(Math.max(0, Math.floor((event.nativeEvent.layout.width + BAR_GAP) / (BAR_WIDTH + BAR_GAP))))}
    >
      {Array.from({ length: count }, (_, index) => {
        const level = levels[levels.length - count + index] ?? 0;
        return (
          <View
            key={index}
            style={[styles.waveBar, { height: BAR_MIN + level * (BAR_MAX - BAR_MIN), backgroundColor: level > 0.1 ? colors.text2 : colors.text3 }]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingTop: space[3],
    paddingBottom: space[2],
    paddingHorizontal: space[2],
    gap: space[2],
  },
  transcript: { maxHeight: type.callout.lineHeight * TRANSCRIPT_LINES, minHeight: type.callout.lineHeight * 2, paddingHorizontal: space[3] },
  controls: { flexDirection: "row", alignItems: "center", gap: space[2] },
  wave: { flex: 1, height: BAR_MAX, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: BAR_GAP, overflow: "hidden" },
  waveBar: { width: BAR_WIDTH, borderRadius: BAR_WIDTH / 2 },
  time: { fontVariant: ["tabular-nums"], minWidth: 40, textAlign: "right" },
  done: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  donePressed: { opacity: 0.8 },
});
