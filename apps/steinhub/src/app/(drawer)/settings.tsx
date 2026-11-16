import Constants from "expo-constants";
import { router } from "expo-router";
import { Bell, MessageSquare, Monitor, Moon, Plus, ScanFace, Type } from "lucide-react-native";
import { StyleSheet, Switch, View } from "react-native";
import { Avatar } from "@/components/avatar";
import { Group, Row, SectionLabel } from "@/components/list";
import { Screen } from "@/components/screen";
import { StatusDot } from "@/components/status";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { bots, host, user } from "@/sample/world";
import { colors, size, space } from "@/theme";

const iconProps = { size: size.icon, color: colors.text2, strokeWidth: size.iconStroke };

export default function SettingsScreen() {
  const version = Constants.expoConfig?.version ?? "0.0.0";

  return (
    <Screen header={<PageTopBar leading="back" />}>
      <LargeTitle>Settings</LargeTitle>
      <Group>
        <Row title={user.name} subtitle={user.email} leading={<Avatar label={user.initials} />} chevron />
      </Group>

      <SectionLabel>Pairing</SectionLabel>
      <Group>
        <Row
          title={host.name}
          subtitle="Paired computer"
          leading={<Monitor {...iconProps} />}
          trailing={
            <View style={styles.online}>
              <StatusDot tone="success" />
              <Txt variant="subhead" tone="secondary">
                Online
              </Txt>
            </View>
          }
          chevron
        />
        <Row title="Pair another computer" leading={<Plus {...iconProps} />} onPress={() => router.navigate("/onboarding")} />
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
        <Row title="Default bot" value={bots[0].name} leading={<MessageSquare {...iconProps} />} chevron />
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
