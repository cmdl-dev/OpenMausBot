import { View } from "react-native";
import { Choice, choiceStyles } from "@/components/choices";
import { SheetContent } from "@/components/sheet";
import { Txt } from "@/components/text";
import { setPreference, startup, THEME_LABELS, usePreferences, type ThemeChoice } from "@/state/preferences";
import { restartApp } from "@/state/restart";

const DETAILS: Record<ThemeChoice, string> = { system: "Matches your phone's appearance", dark: "Always dark", light: "Always light" };

export default function ThemeSheet() {
  const { theme } = usePreferences();
  async function choose(next: ThemeChoice) {
    await setPreference("theme", next);
    if (next !== startup.theme) await restartApp();
  }
  return (
    <SheetContent
      label="Theme"
      header={
        <View style={choiceStyles.header}>
          <Txt variant="headline">Theme</Txt>
          <Txt variant="subhead" tone="secondary">
            SteinHub restarts to apply a new theme.
          </Txt>
        </View>
      }
    >
      <View style={choiceStyles.list}>
        {(Object.keys(THEME_LABELS) as ThemeChoice[]).map((choice) => (
          <Choice key={choice} label={THEME_LABELS[choice]} detail={DETAILS[choice]} selected={theme === choice} onPress={() => void choose(choice)} />
        ))}
      </View>
    </SheetContent>
  );
}
