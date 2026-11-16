import {
  formatPairingCode,
  PAIRING_INPUT_PROBLEM_KEY,
  PAIRING_INPUT_PROBLEM_TEXT,
  readPairingInput,
} from "@openmausbot/phone-protocol/pairing-code.ts";
import { router } from "expo-router";
import { Monitor, QrCode, X } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { Button } from "@/components/button";
import { IconButton } from "@/components/icon-button";
import { Screen } from "@/components/screen";
import { SteinHubMark } from "@/components/steinhub-mark";
import { Txt } from "@/components/text";
import { host } from "@/sample/world";
import { colors, radius, size, space, type } from "@/theme";

type Step = "welcome" | "code" | "confirm";

function close() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

export default function OnboardingScreen() {
  const [step, setStep] = useState<Step>("welcome");
  const [input, setInput] = useState("");
  const pairing = readPairingInput(input);
  const problem = pairing.kind === "wrong" ? PAIRING_INPUT_PROBLEM_TEXT[PAIRING_INPUT_PROBLEM_KEY[pairing.problem]] : null;
  const canContinue = pairing.kind === "code" || pairing.kind === "credential";

  function tidyCode() {
    if (pairing.kind === "code") setInput(formatPairingCode(pairing.code));
  }

  return (
    <Screen
      scroll={false}
      header={
        <View style={styles.bar}>
          <IconButton icon={X} label="Close" onPress={close} />
        </View>
      }
    >
      {step === "welcome" ? (
        <View style={styles.body}>
          <View style={styles.hero}>
            <SteinHubMark />
            <Txt variant="display" style={styles.wordmark}>
              SteinHub
            </Txt>
            <Txt variant="callout" tone="secondary" style={styles.centerText}>
              Your OpenMausBot team, on your phone. Pair with the computer that runs it.
            </Txt>
          </View>
          <View style={styles.actions}>
            <Button label="Scan QR code" block onPress={() => setStep("confirm")} />
            <Button label="Enter a pairing code" variant="secondary" block onPress={() => setStep("code")} />
          </View>
        </View>
      ) : null}

      {step === "code" ? (
        <View style={styles.body}>
          <View style={styles.form}>
            <Txt variant="title">Enter pairing code</Txt>
            <Txt variant="subhead" tone="secondary">
              On the computer, open Settings → Phone & devices and make a pairing code.
            </Txt>
            <TextInput
              accessibilityLabel="Pairing code"
              value={input}
              onChangeText={setInput}
              onBlur={tidyCode}
              placeholder="7KQ2-M9XD-H4TP"
              placeholderTextColor={colors.text3}
              selectionColor={colors.text}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[styles.codeInput, problem ? styles.codeInputError : null]}
            />
            {problem ? (
              <Txt variant="footnote" style={{ color: colors.danger }}>
                {problem}
              </Txt>
            ) : null}
          </View>
          <View style={styles.actions}>
            <Button label="Continue" block onPress={canContinue ? () => setStep("confirm") : undefined} />
          </View>
        </View>
      ) : null}

      {step === "confirm" ? (
        <View style={styles.body}>
          <View style={styles.hero}>
            <View style={styles.hostTile}>
              <Monitor size={32} color={colors.text} strokeWidth={size.iconStroke} />
            </View>
            <Txt variant="title">Pair with {host.name}?</Txt>
            <Txt variant="callout" tone="secondary" style={styles.centerText}>
              Check that the computer shows this phone, then allow it there.
            </Txt>
            <View style={styles.qrHint}>
              <QrCode size={16} color={colors.text3} strokeWidth={size.iconStroke} />
              <Txt variant="footnote" tone="tertiary">
                {host.app}
              </Txt>
            </View>
          </View>
          <View style={styles.actions}>
            <Button label="Pair" block onPress={() => router.replace("/")} />
            <Button label="Cancel" variant="secondary" block onPress={() => setStep("welcome")} />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { height: size.topbar, paddingHorizontal: space[2], flexDirection: "row", alignItems: "center" },
  body: { flex: 1, paddingHorizontal: space[4], paddingBottom: space[4], justifyContent: "space-between" },
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[3] },
  wordmark: { marginTop: space[5] },
  centerText: { textAlign: "center", maxWidth: 300 },
  form: { gap: space[3], paddingTop: space[6] },
  codeInput: {
    ...type.title,
    color: colors.text,
    height: 56,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    letterSpacing: 2,
  },
  codeInputError: { borderColor: colors.danger },
  actions: { gap: space[3] },
  hostTile: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  qrHint: { flexDirection: "row", alignItems: "center", gap: 6 },
});
