import { CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import { router } from "expo-router";
import { Inbox, Keyboard, MessageSquare, Monitor, QrCode, Zap, ChevronLeft, X, type LucideIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, TextInput, View } from "react-native";
import { problemText } from "@/api/errors";
import { readManualPairing, readPairingLink, type PairingInvite } from "@/api/pairing";
import { Button } from "@/components/button";
import { IconButton } from "@/components/icon-button";
import { Screen } from "@/components/screen";
import { SteinHubMark } from "@/components/steinhub-mark";
import { Txt } from "@/components/text";
import { useConnection } from "@/state/connection";
import { host } from "@/sample/world";
import { colors, radius, size, space, type } from "@/theme";

type Step = "welcome" | "scan" | "code" | "confirm";

const SETUP_STEPS = ["Open OpenMausBot", "Go to Settings → Phone & devices", "Choose Pair a phone to show a code"];

const GRANTS: Array<{ icon: LucideIcon; text: string }> = [
  { icon: MessageSquare, text: "Chat with your bots" },
  { icon: Inbox, text: "Answer approvals in your chats" },
  { icon: Zap, text: "View, run, and pause automations" },
];

const DEMO_INVITE: PairingInvite = { urls: ["http://mac-studio.local:8810"], credential: "482913", code: "482913", name: host.name };

function deviceName(): string {
  return Constants.deviceName?.trim() || "SteinHub phone";
}

function inviteName(invite: PairingInvite): string {
  if (invite.name) return invite.name;
  try {
    return new URL(invite.urls[0]).hostname;
  } catch {
    return "this computer";
  }
}

export default function OnboardingScreen() {
  const connection = useConnection();
  const [step, setStep] = useState<Step>("welcome");
  const [invite, setInvite] = useState<PairingInvite | null>(null);
  const demo = connection.mode === "demo";
  const canClose = connection.mode !== "unpaired";

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  function confirm(next: PairingInvite) {
    setInvite(next);
    setStep("confirm");
  }

  const back = step === "welcome" ? null : () => setStep(step === "confirm" && invite?.code === undefined ? "code" : "welcome");

  return (
    <Screen
      scroll={false}
      header={
        <View style={styles.bar}>
          {back ? <IconButton icon={step === "scan" ? X : ChevronLeft} label="Back" onPress={back} /> : <View style={styles.spacer} />}
          <Txt variant="headline">{step === "scan" ? "Scan code" : step === "code" ? "Enter code" : step === "confirm" ? "Confirm pairing" : ""}</Txt>
          {canClose && step === "welcome" ? <IconButton icon={X} label="Close" onPress={close} /> : <View style={styles.spacer} />}
        </View>
      }
    >
      {step === "welcome" ? <Welcome onScan={() => setStep("scan")} onCode={() => setStep("code")} /> : null}
      {step === "scan" ? <Scan demo={demo} onInvite={confirm} onCode={() => setStep("code")} /> : null}
      {step === "code" ? <ManualCode onInvite={confirm} /> : null}
      {step === "confirm" ? (
        <Confirm
          invite={invite ?? DEMO_INVITE}
          demo={demo}
          onCancel={() => setStep("welcome")}
          onPair={async (chosen) => {
            if (demo) {
              router.replace("/");
              return;
            }
            await connection.pairWith(chosen, deviceName());
            router.replace("/");
          }}
        />
      ) : null}
    </Screen>
  );
}

function Welcome({ onScan, onCode }: { onScan: () => void; onCode: () => void }) {
  return (
    <View style={styles.body}>
      <View style={styles.hero}>
        <SteinHubMark />
        <Txt variant="display" style={styles.wordmark}>
          SteinHub
        </Txt>
        <Txt variant="callout" tone="secondary" style={styles.centerText}>
          Your OpenMausBot bots, in your pocket.
        </Txt>
      </View>
      <View style={styles.card}>
        <Txt variant="footnote" tone="secondary">
          On your computer
        </Txt>
        {SETUP_STEPS.map((text, index) => (
          <View key={text} style={styles.stepRow}>
            <View style={styles.stepNumber}>
              <Txt variant="caption" weight="600">
                {index + 1}
              </Txt>
            </View>
            <Txt variant="subhead" style={styles.fill}>
              {text}
            </Txt>
          </View>
        ))}
      </View>
      <View style={styles.actions}>
        <Button label="Pair with your computer" icon={QrCode} block onPress={onScan} />
        <Button label="Enter code manually" variant="ghost" block onPress={onCode} />
      </View>
    </View>
  );
}

function Scan({ demo, onInvite, onCode }: { demo: boolean; onInvite: (invite: PairingInvite) => void; onCode: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState("Looking for a code");
  const handled = useRef(false);

  useEffect(() => {
    if (!demo && permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [demo, permission, requestPermission]);

  const blocked = !demo && permission !== null && !permission.granted && !permission.canAskAgain;

  return (
    <View style={styles.body}>
      <View style={styles.scanArea}>
        <View style={styles.pill}>
          <View style={[styles.dot, { backgroundColor: blocked ? colors.danger : colors.info }]} />
          <Txt variant="footnote">{blocked ? "Camera access is off" : status}</Txt>
        </View>
        <View style={styles.viewfinder}>
          {demo ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Use the sample code" style={StyleSheet.absoluteFill} onPress={() => onInvite(DEMO_INVITE)} />
          ) : null}
          {!demo && permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                if (handled.current) return;
                const invite = readPairingLink(data);
                if (!invite) {
                  setStatus("That QR code isn't a pairing code from OpenMausBot.");
                  return;
                }
                handled.current = true;
                onInvite(invite);
              }}
            />
          ) : null}
          {blocked ? (
            <View style={styles.blocked}>
              <Txt variant="headline">Camera access is off</Txt>
              <Button label="Open Settings" variant="secondary" small onPress={() => void Linking.openSettings()} />
            </View>
          ) : (
            <View pointerEvents="none" style={styles.corners}>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
            </View>
          )}
        </View>
      </View>
      <View style={styles.scanFoot}>
        <Txt variant="callout" style={styles.centerText}>
          Open OpenMausBot on your computer, go to Settings → Phone & devices, choose Pair a phone, and scan the code.
        </Txt>
        <Button label="Enter code manually" icon={Keyboard} variant="outline" small onPress={onCode} />
      </View>
    </View>
  );
}

function ManualCode({ onInvite }: { onInvite: (invite: PairingInvite) => void }) {
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [tried, setTried] = useState(false);
  const reading = readManualPairing(address, code);
  const problem = tried && reading.kind === "problem" ? reading : null;

  return (
    <View style={styles.body}>
      <View style={styles.form}>
        <Txt variant="subhead" tone="secondary">
          On the computer, open Settings → Phone & devices and choose Pair a phone. It shows its address and a six-digit code.
        </Txt>
        <Txt variant="footnote" tone="secondary" weight="500">
          Computer address
        </Txt>
        <TextInput
          accessibilityLabel="Computer address"
          value={address}
          onChangeText={setAddress}
          placeholder="mac-studio.local:8810"
          placeholderTextColor={colors.text3}
          selectionColor={colors.text}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[styles.input, problem?.field === "address" ? styles.inputError : null]}
        />
        <Txt variant="footnote" tone="secondary" weight="500">
          Pairing code
        </Txt>
        <TextInput
          accessibilityLabel="Pairing code"
          value={code}
          onChangeText={setCode}
          placeholder="482 913"
          placeholderTextColor={colors.text3}
          selectionColor={colors.text}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="number-pad"
          style={[styles.input, styles.codeInput, problem?.field === "code" ? styles.inputError : null]}
        />
        {problem ? (
          <Txt variant="footnote" style={styles.errorText}>
            {problem.text}
          </Txt>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button
          label="Continue"
          block
          disabled={reading.kind === "incomplete"}
          onPress={() => {
            setTried(true);
            if (reading.kind === "ready") onInvite(reading.invite);
          }}
        />
      </View>
    </View>
  );
}

function Confirm({
  invite,
  demo,
  onPair,
  onCancel,
}: {
  invite: PairingInvite;
  demo: boolean;
  onPair: (invite: PairingInvite) => Promise<void>;
  onCancel: () => void;
}) {
  const [pairing, setPairing] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const name = inviteName(invite);

  async function pair() {
    setPairing(true);
    setFailure(null);
    try {
      await onPair(invite);
    } catch (error) {
      setFailure(error);
      setPairing(false);
    }
  }

  return (
    <View style={styles.body}>
      <View style={styles.confirm}>
        <View style={styles.hostHero}>
          <View style={styles.hostTile}>
            <Monitor size={28} color={colors.text} strokeWidth={size.iconStroke} />
          </View>
          <Txt variant="title" numberOfLines={1}>
            {name}
          </Txt>
          <View style={styles.hostLine}>
            {demo ? <View style={[styles.dot, { backgroundColor: colors.success }]} /> : null}
            <Txt variant="footnote" tone="secondary" numberOfLines={1}>
              {demo ? `${host.app} · Same network` : invite.urls[0].replace(/^https?:\/\//, "")}
            </Txt>
          </View>
        </View>
        {invite.code ? (
          <View style={styles.codeCard}>
            <Txt variant="footnote" tone="secondary">
              Check that this code matches your computer
            </Txt>
            <Txt variant="display" accessibilityLabel={`Code ${invite.code.split("").join(" ")}`} style={styles.code}>
              {`${invite.code.slice(0, 3)} ${invite.code.slice(3)}`}
            </Txt>
          </View>
        ) : null}
        <Txt variant="overline" tone="secondary">
          This phone will be able to
        </Txt>
        {GRANTS.map((grant) => (
          <View key={grant.text} style={styles.grant}>
            <grant.icon size={size.icon} color={colors.text2} strokeWidth={size.iconStroke} />
            <Txt variant="callout" style={styles.fill}>
              {grant.text}
            </Txt>
          </View>
        ))}
        <View style={styles.fill} />
        <Txt variant="footnote" tone="tertiary" style={styles.centerSelf}>
          You can unpair any time in Settings → Pairing.
        </Txt>
        {failure ? (
          <Txt variant="footnote" style={styles.errorText}>
            {problemText(failure, name)}
          </Txt>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button label={pairing ? "Pairing…" : failure ? "Try again" : "Pair"} block disabled={pairing} onPress={() => void pair()} />
        <Button label="Cancel" variant="ghost" block disabled={pairing} onPress={onCancel} />
      </View>
    </View>
  );
}

const CORNER = 28;

const styles = StyleSheet.create({
  bar: { height: size.topbar, paddingHorizontal: space[2], flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  spacer: { width: size.tap },
  fill: { flex: 1 },
  body: { flex: 1, paddingHorizontal: space[4], paddingBottom: space[4], justifyContent: "space-between", gap: space[4] },
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[3] },
  wordmark: { marginTop: space[5] },
  centerText: { textAlign: "center", maxWidth: 320 },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space[4],
    gap: space[3],
  },
  stepRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: { gap: space[3] },
  scanArea: { flex: 1, alignItems: "center", gap: space[8], paddingTop: space[2] },
  scanFoot: { alignItems: "center", gap: space[4] },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[3],
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surface1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  viewfinder: {
    width: 260,
    height: 260,
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: colors.surface1,
  },
  corners: { ...StyleSheet.absoluteFill, margin: space[5] },
  corner: { position: "absolute", width: CORNER, height: CORNER, borderColor: colors.text },
  cornerTopLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: radius.md },
  cornerTopRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: radius.md },
  cornerBottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: radius.md },
  cornerBottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: radius.md },
  blocked: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: space[3], padding: space[4] },
  form: { gap: space[2], paddingTop: space[4] },
  input: {
    ...type.callout,
    color: colors.text,
    height: 52,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    marginBottom: space[2],
  },
  codeInput: { ...type.title, letterSpacing: 4 },
  inputError: { borderColor: colors.danger },
  errorText: { color: colors.danger },
  confirm: { flex: 1, gap: space[3], paddingTop: space[2] },
  hostHero: { alignItems: "center", gap: space[2], paddingBottom: space[2] },
  hostLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  centerSelf: { textAlign: "center" },
  hostTile: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  codeCard: {
    alignItems: "center",
    gap: space[2],
    paddingVertical: space[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  code: { fontSize: 36, lineHeight: 44, letterSpacing: 3 },
  grant: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 34 },
});
