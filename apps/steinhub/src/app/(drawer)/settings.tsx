import Constants from "expo-constants";
import { router } from "expo-router";
import { FlaskConical, LockKeyhole, MessageSquare, Monitor, Moon, Plus, QrCode, ScanFace, Smartphone, Type, Unlink } from "lucide-react-native";
import { useState } from "react";
import { Alert, Platform, StyleSheet, Switch, View } from "react-native";
import { Avatar } from "@/components/avatar";
import { Group, Row, SectionLabel } from "@/components/list";
import { Screen } from "@/components/screen";
import { StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { confirmOwner, useLockMethod } from "@/state/app-lock";
import { useConnection } from "@/state/connection";
import { setPreference, TEXT_SIZE_LABELS, THEME_LABELS, usePreferences } from "@/state/preferences";
import { initials } from "@/state/views";
import { useWorld } from "@/state/world";
import { colors, size, space } from "@/theme";

const iconProps = { size: size.icon, color: colors.text2, strokeWidth: size.iconStroke };

export default function SettingsScreen() {
  const version = Constants.expoConfig?.version ?? "0.0.0";
  const world = useWorld();
  const connection = useConnection();
  const { session } = connection;
  const live = world.source === "live" && session;
  const prefs = usePreferences();
  const lockMethod = useLockMethod(Platform.OS);
  const [lockBusy, setLockBusy] = useState(false);
  const defaultBot = prefs.defaultBot ? world.bot(prefs.defaultBot) : null;

  async function toggleLock(on: boolean) {
    setLockBusy(true);
    try {
      if (await confirmOwner(on ? `Use ${lockMethod ?? "Face ID"} to open SteinHub` : "Turn off the SteinHub lock")) await setPreference("lock", on);
    } finally {
      setLockBusy(false);
    }
  }

  function unpair() {
    Alert.alert(
      `Unpair from ${world.host.name}?`,
      `SteinHub forgets this computer and its key on this phone. To revoke this phone on the computer too, remove it in Settings → Phone & devices there.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unpair",
          style: "destructive",
          onPress: () => {
            void connection.forget().then(() => router.replace("/onboarding"));
          },
        },
      ],
    );
  }

  return (
    <Screen header={<PageTopBar leading="back" />}>
      <LargeTitle>Settings</LargeTitle>
      <Group>
        {world.person ? (
          <Row title={world.person.name} subtitle={world.person.email} leading={<Avatar label={world.person.initials} />} />
        ) : (
          <Row title={world.host.name} subtitle={session ? `This phone: ${session.device.name}` : undefined} leading={<Avatar label={initials(world.host.name)} />} />
        )}
      </Group>

      <SectionLabel>Pairing</SectionLabel>
      <Group>
        <Row
          title={world.host.name}
          subtitle="Paired computer"
          leading={<Monitor {...iconProps} />}
          trailing={
            <View style={styles.online}>
              <StatusDot tone={world.host.status.tone} />
              <Txt variant="subhead" tone="secondary">
                {world.host.status.label}
              </Txt>
            </View>
          }
        />
        {live ? <Row title="App" value={world.host.app} /> : null}
        {live ? <Row title="Paired" value={world.host.paired} /> : null}
        {live ? <Row title="This phone" value={session.device.name} leading={<Smartphone {...iconProps} />} /> : null}
        {live ? (
          <Row title="Re-pair with QR" subtitle="Use if the connection keeps failing" leading={<QrCode {...iconProps} />} onPress={() => router.navigate("/onboarding")} />
        ) : (
          <Row title="Pair another computer" leading={<Plus {...iconProps} />} onPress={() => router.navigate("/onboarding")} />
        )}
        {live ? <Row title="Unpair this phone" destructive leading={<Unlink size={size.icon} color={colors.danger} strokeWidth={size.iconStroke} />} onPress={unpair} /> : null}
      </Group>

      <SectionLabel>Appearance</SectionLabel>
      <Group>
        <Row title="Theme" value={THEME_LABELS[prefs.theme]} leading={<Moon {...iconProps} />} chevron onPress={() => router.push("/sheets/theme")} />
        <Row title="Text size" value={TEXT_SIZE_LABELS[prefs.textSize]} leading={<Type {...iconProps} />} chevron onPress={() => router.push("/sheets/text-size")} />
      </Group>

      <SectionLabel>Bots</SectionLabel>
      <Group>
        <Row
          title="Default bot"
          subtitle="A new chat starts with it"
          value={defaultBot?.name ?? (world.bots[0] ? `${world.bots[0].name} (first)` : "None")}
          leading={<MessageSquare {...iconProps} />}
          chevron
          onPress={() => router.push("/sheets/default-bot")}
        />
      </Group>

      <SectionLabel>Privacy & security</SectionLabel>
      <Group>
        <Row title="Vault" subtitle="Passwords, keys and cards your bots can use" leading={<LockKeyhole {...iconProps} />} chevron onPress={() => router.push("/vault")} />
        <Row
          title={`${lockMethod ?? "Face ID"} lock`}
          subtitle={lockMethod === "Passcode" ? "Opens with your phone's passcode" : "Asks when SteinHub opens or comes back"}
          leading={<ScanFace {...iconProps} />}
          trailing={
            <Switch
              accessibilityLabel="App lock"
              value={prefs.lock}
              disabled={lockBusy}
              onValueChange={(on) => void toggleLock(on)}
              trackColor={{ false: colors.surface3, true: colors.success }}
            />
          }
        />
      </Group>

      {connection.demoAvailable ? (
        <>
          <SectionLabel>Development</SectionLabel>
          <Group>
            <Row
              title="Demo mode"
              subtitle={connection.mode === "demo" ? "Showing the sample world" : session ? `Showing ${session.serverName}` : "Not paired"}
              leading={<FlaskConical {...iconProps} />}
              trailing={
                <Switch
                  accessibilityLabel="Demo mode"
                  value={connection.mode === "demo"}
                  onValueChange={(on) => void connection.setDemo(on)}
                  trackColor={{ false: colors.surface3, true: colors.success }}
                  thumbColor={colors.text}
                />
              }
            />
          </Group>
        </>
      ) : null}

      <Txt variant="footnote" tone="tertiary" style={styles.about}>
        SteinHub {version}
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  online: { flexDirection: "row", alignItems: "center", gap: 6 },
  about: { textAlign: "center", paddingTop: space[6] },
});
