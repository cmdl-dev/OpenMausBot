import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { problemText } from "@/api/errors";
import { Button } from "@/components/button";
import { StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { useConnection } from "@/state/connection";
import { colors, radius, space } from "@/theme";

const CONNECTING_GRACE_MS = 2_000;

/** Says when the paired computer can't be reached, and offers the next step. Silent while online. */
export function LinkBanner() {
  const { mode, link, problem, session, retry } = useConnection();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    setSlow(false);
    if (link !== "connecting") return;
    const timer = setTimeout(() => setSlow(true), CONNECTING_GRACE_MS);
    return () => clearTimeout(timer);
  }, [link]);

  if (mode !== "live" || link === "online" || (link === "connecting" && !slow)) return null;
  const computer = session?.serverName ?? "the computer";
  const repair = link === "signed-out" || link === "update-app";
  const text = link === "connecting" ? `Connecting to ${computer}…` : problemText(problem ?? new Error(link), computer);

  return (
    <View accessibilityRole="alert" style={styles.banner}>
      <View style={styles.text}>
        <StatusDot tone={link === "connecting" ? "info" : "danger"} />
        <Txt variant="footnote" tone="secondary" style={styles.fill}>
          {text}
        </Txt>
      </View>
      {link === "connecting" ? null : (
        <Button
          label={repair ? "Pair again" : "Try again"}
          variant="secondary"
          small
          onPress={repair ? () => router.navigate("/onboarding") : retry}
        />
      )}
    </View>
  );
}

/** Marks a screen whose data the computer doesn't serve to phones yet. */
export function SampleNote({ children }: { children: string }) {
  return (
    <View style={styles.sample}>
      <Txt variant="footnote" tone="secondary">
        {children}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: space[3],
    marginBottom: space[2],
    padding: space[3],
    gap: space[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: { flexDirection: "row", alignItems: "center", gap: space[2] },
  fill: { flex: 1 },
  sample: {
    marginHorizontal: space[4],
    marginBottom: space[3],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
