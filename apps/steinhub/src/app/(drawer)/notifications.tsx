import { router } from "expo-router";
import { Bell, BellOff, Moon } from "lucide-react-native";
import { Linking, StyleSheet, Switch, View } from "react-native";
import { Button } from "@/components/button";
import { Group, Row, SectionLabel } from "@/components/list";
import { Screen } from "@/components/screen";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { setPreference, usePreferences, type NotifyChoices } from "@/state/preferences";
import { usePushState, type PushState } from "@/state/push";
import { useWorld } from "@/state/world";
import { colors, size, space } from "@/theme";

const CHOICES: Array<{ key: keyof NotifyChoices; title: string; subtitle: string }> = [
  { key: "needsYou", title: "When a bot needs you", subtitle: "An approval, a question or a sign-in it's waiting on" },
  { key: "alerts", title: "Important alerts", subtitle: "A bot found something you should see now" },
  { key: "reminders", title: "Reminders you asked for", subtitle: '"Tell me when…" and other waits that fire' },
  { key: "replies", title: "Every finished reply", subtitle: "Each reply and routine report, important or not" },
];

/** What reaches this phone when SteinHub is closed, and when it stays quiet. */
export default function NotificationsScreen() {
  const world = useWorld();
  const prefs = usePreferences();
  const push = usePushState();

  return (
    <Screen header={<PageTopBar leading="back" />}>
      <LargeTitle>Notifications</LargeTitle>
      <View style={styles.status}>
        <Status push={push} host={world.host.name} />
      </View>

      <SectionLabel>Notify me</SectionLabel>
      <Group>
        {CHOICES.map(({ key, title, subtitle }) => (
          <Row
            key={key}
            title={title}
            subtitle={subtitle}
            trailing={
              <Switch
                accessibilityLabel={title}
                value={prefs.notify[key]}
                onValueChange={(on) => void setPreference("notify", { ...prefs.notify, [key]: on })}
                trackColor={{ false: colors.surface3, true: colors.success }}
              />
            }
          />
        ))}
      </Group>
      <Txt variant="footnote" tone="tertiary" style={styles.note}>
        Routines that check something every few minutes only notify you when a bot decides what it found is important.
      </Txt>

      <SectionLabel>Quiet hours</SectionLabel>
      <Group>
        <Row
          title="Quiet hours"
          subtitle="Notifications arrive silently, without sound or a banner"
          leading={<Moon size={size.icon} color={colors.text2} strokeWidth={size.iconStroke} />}
          trailing={
            <Switch
              accessibilityLabel="Quiet hours"
              value={prefs.quiet.on}
              onValueChange={(on) => void setPreference("quiet", { ...prefs.quiet, on })}
              trackColor={{ false: colors.surface3, true: colors.success }}
            />
          }
        />
        {prefs.quiet.on ? (
          <Row title="From" value={prefs.quiet.start} chevron onPress={() => router.push({ pathname: "/sheets/quiet-time", params: { which: "start" } })} />
        ) : null}
        {prefs.quiet.on ? (
          <Row title="Until" value={prefs.quiet.end} chevron onPress={() => router.push({ pathname: "/sheets/quiet-time", params: { which: "end" } })} />
        ) : null}
      </Group>
      {push.problem ? (
        <Txt variant="footnote" style={[styles.note, styles.problem]}>
          {push.problem}
        </Txt>
      ) : null}
      <Txt variant="footnote" tone="tertiary" style={styles.note}>
        {`${world.host.name} sends these while SteinHub is closed. While it's open you see everything in the app.`}
      </Txt>
    </Screen>
  );
}

function Status({ push, host }: { push: PushState; host: string }) {
  if (push.permission === "unsupported") {
    return <Line icon="off" text="This phone can't get SteinHub notifications yet." />;
  }
  if (push.permission === "denied") {
    return (
      <>
        <Line icon="off" text="Notifications are off for SteinHub in iOS Settings." />
        <Button label="Open Settings" variant="secondary" small onPress={() => void Linking.openSettings()} />
      </>
    );
  }
  if (push.permission === "undetermined") {
    return (
      <>
        <Line icon="off" text="SteinHub hasn't asked to notify you yet." />
        <Button label="Turn on notifications" small onPress={() => void push.enable()} />
      </>
    );
  }
  if (push.server === "on") return <Line icon="on" text={`On. ${host} will notify this phone.`} />;
  if (push.server === "off" || push.server === "no-account") {
    return <Line icon="off" text={`This phone is ready, but ${host} isn't set up to send notifications yet.`} />;
  }
  return <Line icon="on" text="Allowed on this phone." />;
}

function Line({ icon, text }: { icon: "on" | "off"; text: string }) {
  const Icon = icon === "on" ? Bell : BellOff;
  return (
    <View style={styles.line}>
      <Icon size={size.icon} color={icon === "on" ? colors.success : colors.text2} strokeWidth={size.iconStroke} />
      <Txt variant="subhead" tone="secondary" style={styles.fill}>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  status: { paddingHorizontal: space[4], gap: space[3], alignItems: "flex-start" },
  line: { flexDirection: "row", alignItems: "center", gap: space[2] },
  fill: { flex: 1 },
  note: { paddingHorizontal: space[4], paddingTop: space[2] },
  problem: { color: colors.danger },
});
