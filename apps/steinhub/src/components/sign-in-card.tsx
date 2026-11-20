import { router } from "expo-router";
import { Check, LogIn, X } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { problemText } from "@/api/errors";
import { Button } from "@/components/button";
import { Badge } from "@/components/status";
import { Txt } from "@/components/text";
import { useConnection } from "@/state/connection";
import type { SignInView } from "@/state/views";
import { colors, radius, size, space } from "@/theme";

/** Where the person signs in when it isn't the bot's own browser, which the phone shows itself. */
const ELSEWHERE: Record<Exclude<SignInView["place"], "browser">, string> = {
  vm: "on the private desktop",
  cloud: "on the cloud desktop",
  local: "on the computer, in the browser",
};

/**
 * A bot waiting for the person to sign in to a website. In the bot's own browser, Open shows it here, already in the
 * person's control; anywhere else they sign in at the computer. Done (or Give back) and Cancel let the bot carry on.
 */
export function SignInCard({ card, botId, botName, threadId, hostName }: { card: SignInView; botId: string; botName: string; threadId: string; hostName: string }) {
  const connection = useConnection();
  const [busy, setBusy] = useState<"done" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asking = card.botId ?? botId;

  if (card.state !== "waiting") return <Settled card={card} botName={botName} />;

  async function answer(outcome: "done" | "cancel") {
    setBusy(outcome);
    setError(null);
    try {
      await connection.answerSignIn(asking, threadId, card.messageId, outcome);
    } catch (failure) {
      setError(problemText(failure, hostName));
    } finally {
      setBusy(null);
    }
  }

  const place = card.place;
  return (
    <View style={styles.card} accessibilityLabel={`${botName} needs you to sign in to ${card.site}`}>
      <View style={styles.badge}>
        <LogIn size={14} color={colors.warning} strokeWidth={size.iconStroke} />
        <Badge label="Sign in needed" tone="warning" />
      </View>
      <Txt variant="headline">
        {botName} needs you to sign in to {card.site}
      </Txt>
      {card.reason ? (
        <Txt variant="subhead" tone="secondary">
          {card.reason}
        </Txt>
      ) : null}
      <Txt variant="footnote" tone="tertiary">
        {place === "browser"
          ? `Open ${botName}'s browser, sign in, then tap Give back. You type the password yourself; ${botName} never sees it.`
          : `Sign in ${ELSEWHERE[place]} ${botName} is using, then tap Done.`}
      </Txt>
      {error ? (
        <Txt variant="footnote" style={styles.error}>
          {error}
        </Txt>
      ) : null}
      <View style={styles.actions}>
        <View style={styles.fill}>
          <Button label={busy === "cancel" ? "Cancel…" : "Cancel"} variant="secondary" block disabled={busy !== null} onPress={() => void answer("cancel")} />
        </View>
        <View style={styles.fill}>
          {place === "browser" ? (
            <Button
              label="Open"
              block
              disabled={busy !== null}
              onPress={() => router.push({ pathname: "/browser", params: { bot: asking, thread: threadId, card: card.messageId } })}
            />
          ) : (
            <Button label={busy === "done" ? "Done…" : "Done"} block disabled={busy !== null} onPress={() => void answer("done")} />
          )}
        </View>
      </View>
    </View>
  );
}

function Settled({ card, botName }: { card: SignInView; botName: string }) {
  const signedIn = card.state === "done";
  const headline = {
    done: card.savedLogin ? `Login saved for ${card.savedLogin}` : `Signed in to ${card.site}`,
    cancelled: `Sign-in to ${card.site} declined`,
    replaced: `${card.site} · a newer request replaced this one`,
    "answered-in-chat": `${card.site} · you answered in the chat`,
    stopped: `${card.site} · stopped`,
  }[card.state as Exclude<SignInView["state"], "waiting">];
  const after = card.state === "done" || card.state === "cancelled" ? (card.resumed ? ` · ${botName} is continuing` : card.error ? " · resuming failed" : "") : "";
  const Icon = signedIn ? Check : X;
  return (
    <View style={styles.settled}>
      <View style={[styles.mark, { backgroundColor: signedIn ? colors.successBg : colors.surface2 }]}>
        <Icon size={12} color={signedIn ? colors.success : colors.text2} strokeWidth={2.5} />
      </View>
      <Txt variant="subhead" tone="secondary" numberOfLines={2} style={styles.fill}>
        {headline}
        {after}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    padding: space[4],
    gap: space[3],
  },
  badge: { flexDirection: "row", alignItems: "center", gap: space[1] },
  error: { color: colors.danger },
  actions: { flexDirection: "row", gap: space[2] },
  settled: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingLeft: space[3],
    paddingRight: 10,
    paddingVertical: space[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mark: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
