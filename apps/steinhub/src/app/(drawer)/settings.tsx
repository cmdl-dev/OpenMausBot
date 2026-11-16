import Constants from "expo-constants";
import { router } from "expo-router";
import { Bell, FlaskConical, MessageSquare, Monitor, Moon, Plus, QrCode, ScanFace, Smartphone, Type, Unlink } from "lucide-react-native";
import { Alert, StyleSheet, Switch, View } from "react-native";
import { Avatar } from "@/components/avatar";
import { Group, Row, SectionLabel } from "@/components/list";
import { Screen } from "@/components/screen";
import { StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { useConnection } from "@/state/connection";
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
          <Row title={world.person.name} subtitle={world.person.email} leading={<Avatar label={world.person.initials} />} chevron />
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
          chevron={!live}
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

      <SectionLabel>Notifications</SectionLabel>
      <Group>
        <Row title="Notifications" value="Quiet 22:00–7:00" leading={<Bell {...iconProps} />} chevron />
      </Group>

      <SectionLabel>Appearance</SectionLabel>
      <Group>
        <Row title="Theme" value="Dark" leading={<Moon {...iconProps} />} chevron />
        <Row title="Text size" value="Default" leading={<Type {...iconProps} />} chevron />
      </Group>

      <SectionLabel>Bots</SectionLabel>
      <Group>
        <Row title="Default bot" value={world.bots[0]?.name ?? "None"} leading={<MessageSquare {...iconProps} />} chevron />
      </Group>

      <SectionLabel>Privacy & security</SectionLabel>
      <Group>
        <Row
          title="Face ID lock"
          leading={<ScanFace {...iconProps} />}
          trailing={
            <Switch
              accessibilityLabel="Face ID lock"
              value
              trackColor={{ false: colors.surface3, true: colors.success }}
              thumbColor={colors.text}
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
