import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { Choice, choiceStyles } from "@/components/choices";
import { SheetContent } from "@/components/sheet";
import { Txt } from "@/components/text";
import { setPreference, usePreferences } from "@/state/preferences";

/** Every half hour of the day, "HH:MM". */
export const QUIET_TIMES = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);

/** When quiet hours start or end. */
export default function QuietTimeSheet() {
  const { which } = useLocalSearchParams<{ which: "start" | "end" }>();
  const prefs = usePreferences();
  const key = which === "end" ? "end" : "start";
  async function choose(time: string) {
    await setPreference("quiet", { ...prefs.quiet, [key]: time });
    router.back();
  }
  return (
    <SheetContent
      label={key === "start" ? "Quiet from" : "Quiet until"}
      header={
        <View style={choiceStyles.header}>
          <Txt variant="headline">{key === "start" ? "Quiet from" : "Quiet until"}</Txt>
        </View>
      }
    >
      <View style={choiceStyles.list}>
        {QUIET_TIMES.map((time) => (
          <Choice key={time} label={time} selected={prefs.quiet[key] === time} onPress={() => void choose(time)} />
        ))}
      </View>
    </SheetContent>
  );
}
