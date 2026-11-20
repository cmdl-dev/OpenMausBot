import { useLocalSearchParams } from "expo-router";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { CallSent } from "@openmausbot/phone-protocol/phone-calls.ts";
import type { CallDetail, CallLine } from "@/api/client";
import { SectionLabel } from "@/components/list";
import { Screen } from "@/components/screen";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { useConnection } from "@/state/connection";
import { useLoaded } from "@/state/use-loaded";
import { CALL_END_TEXT, callState, clock, formatWhen } from "@/state/views";
import { useWorld } from "@/state/world";
import { colors, radius, size, space } from "@/theme";

function speakerName(call: CallDetail, line: CallLine): string {
  if (line.speaker === "bot") return call.botName;
  if (line.speaker === "callee") return call.calleeName ?? call.to;
  return "Note";
}

export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const world = useWorld();
  const { call: readCall } = useConnection();
  const loaded = useLoaded(() => readCall(id), `${world.source}:${id}`, world.host.name);

  return (
    <Screen header={<PageTopBar leading="back" />} refresh={{ refreshing: loaded.reloading, onRefresh: loaded.reload }}>
      {loaded.state === "loading" ? (
        <Txt variant="subhead" tone="tertiary" style={styles.note}>
          Loading…
        </Txt>
      ) : loaded.state === "failed" ? (
        <Txt variant="subhead" style={[styles.note, styles.problem]}>
          {loaded.problem}
        </Txt>
      ) : !loaded.value ? (
        <Txt variant="subhead" tone="tertiary" style={styles.note}>
          This call isn't on the computer any more.
        </Txt>
      ) : (
        <CallBody call={loaded.value} />
      )}
    </Screen>
  );
}

function CallBody({ call }: { call: CallDetail }) {
  const ended = call.phase === "ended";
  return (
    <>
      <LargeTitle>{call.calleeName ?? call.to}</LargeTitle>
      <Txt variant="subhead" tone="secondary" style={styles.lede}>
        {[call.calleeName ? call.to : null, call.botName, formatWhen(call.createdAt), callState(call)].filter(Boolean).join(" · ")}
      </Txt>
      <Txt variant="footnote" tone="secondary" style={styles.lede}>
        {ended ? CALL_END_TEXT[call.endReason ?? "completed"] : "This call is still going. Pull down for what was said since."}
      </Txt>

      <SectionLabel>Brief</SectionLabel>
      <View style={styles.card}>
        <Txt variant="callout">{call.brief}</Txt>
      </View>

      <SectionLabel>Transcript</SectionLabel>
      {call.transcript.length === 0 ? (
        <Txt variant="subhead" tone="tertiary" style={styles.note}>
          Nothing was said.
        </Txt>
      ) : (
        <View style={styles.card}>
          {call.transcript.map((line, index) => (
            <View key={`${line.at}-${index}`} style={styles.line}>
              <View style={styles.lineHead}>
                <Txt variant="caption" tone={line.speaker === "bot" ? "primary" : "secondary"} numberOfLines={1} style={styles.fill}>
                  {speakerName(call, line)}
                </Txt>
                <Txt variant="caption" tone="tertiary">
                  {clock(line.at)}
                </Txt>
              </View>
              <Txt variant="callout" tone={line.speaker === "note" ? "tertiary" : "primary"} accessibilityLabel={line.cut ? `${line.text} (cut off)` : undefined}>
                {line.cut ? `${line.text}…` : line.text}
              </Txt>
            </View>
          ))}
        </View>
      )}

      {call.sent ? <SentSection sent={call.sent} /> : null}
    </>
  );
}

const SENT_TEXTS = [
  ["disclosure", "Disclosure"],
  ["instructions", "Voice instructions"],
  ["opening", "Opening"],
  ["wrapUp", "Wrap-up"],
  ["goodbye", "Goodbye"],
] as const satisfies ReadonlyArray<readonly [keyof CallSent, string]>;

function SentSection({ sent }: { sent: CallSent }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  const values: Array<[string, string]> = [
    ["Realtime model", sent.model],
    ["Voice", sent.voice],
    ["Transcription model", sent.transcriptionModel],
    ["Turn detection", Object.entries(sent.turnDetection).map(([name, value]) => (name === "type" ? String(value) : `${name} ${value}`)).join(" · ")],
    ["Noise reduction", sent.noiseReduction],
    ["Turns without a reply before hanging up", String(sent.maxTurnsWithoutReply)],
    ["Max call minutes", String(sent.maxMinutes)],
  ];
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((value) => !value)} style={styles.sentToggle}>
        <Txt variant="overline" tone="secondary" style={styles.fill}>
          What was sent
        </Txt>
        <Chevron size={14} color={colors.text3} strokeWidth={size.iconStroke} />
      </Pressable>
      {open ? (
        <View style={styles.card}>
          {SENT_TEXTS.map(([key, label]) => (
            <View key={key} style={styles.line}>
              <Txt variant="caption" tone="secondary">
                {label}
              </Txt>
              <Txt variant="footnote" mono selectable>
                {sent[key]}
              </Txt>
            </View>
          ))}
          {values.map(([label, value]) => (
            <View key={label} style={styles.line}>
              <Txt variant="caption" tone="secondary">
                {label}
              </Txt>
              <Txt variant="footnote" selectable>
                {value}
              </Txt>
            </View>
          ))}
          <View style={styles.line}>
            <Txt variant="caption" tone="secondary">
              Realtime session, as sent
            </Txt>
            <Txt variant="footnote" mono selectable>
              {JSON.stringify(sent.session, null, 2)}
            </Txt>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  lede: { paddingHorizontal: space[5], paddingBottom: space[2] },
  note: { textAlign: "center", marginTop: space[8], paddingHorizontal: space[6] },
  problem: { color: colors.danger },
  fill: { flex: 1 },
  card: {
    marginHorizontal: space[4],
    padding: space[4],
    gap: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  line: { gap: space[1] },
  lineHead: { flexDirection: "row", alignItems: "center", gap: space[2] },
  sentToggle: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[4], paddingTop: space[6], paddingBottom: space[2] },
});
