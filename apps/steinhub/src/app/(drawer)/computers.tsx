import { Laptop, Monitor, Plus, Server, type LucideIcon } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { Group, Row, SectionLabel } from "@/components/list";
import { Screen } from "@/components/screen";
import { Badge } from "@/components/status";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { computers } from "@/sample/world";
import { colors, radius, size, space } from "@/theme";

const KIND_ICONS: Record<string, LucideIcon> = { "Desktop host": Monitor, Laptop, VPS: Server };

export default function ComputersScreen() {
  return (
    <Screen header={<PageTopBar leading="menu" action={{ icon: Plus, label: "Add computer" }} />}>
      <LargeTitle>Computers</LargeTitle>
      <SectionLabel>Your computers</SectionLabel>
      <Group>
        {computers.map((computer) => {
          const Icon = KIND_ICONS[computer.kind] ?? Monitor;
          return (
            <Row
              key={computer.id}
              title={computer.name}
              subtitle={`${computer.kind} · ${computer.os} · ${computer.detail}`}
              leading={
                <View style={styles.tile}>
                  <Icon size={size.icon} color={colors.text} strokeWidth={size.iconStroke} />
                </View>
              }
              trailing={<Badge label={computer.state.label} tone={computer.state.tone} />}
              chevron
            />
          );
        })}
      </Group>
      <Txt variant="footnote" tone="tertiary" style={styles.note}>
        Bots run on these computers. The desktop host keeps your threads, credentials and automations.
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  note: { paddingHorizontal: space[5], paddingTop: space[3] },
});
