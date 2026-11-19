import { StyleSheet, Text, View } from "react-native";
import { Choice, choiceStyles } from "@/components/choices";
import { SheetContent } from "@/components/sheet";
import { Txt } from "@/components/text";
import { setPreference, startup, TEXT_SCALES, TEXT_SIZE_LABELS, usePreferences, type TextSize } from "@/state/preferences";
import { restartApp } from "@/state/restart";
import { colors, textScale, type } from "@/theme";

export default function TextSizeSheet() {
  const { textSize } = usePreferences();
  async function choose(next: TextSize) {
    await setPreference("textSize", next);
    if (next !== startup.textSize) await restartApp();
  }
  return (
    <SheetContent
      label="Text size"
      header={
        <View style={choiceStyles.header}>
          <Txt variant="headline">Text size</Txt>
          <Txt variant="subhead" tone="secondary">
            On top of your phone&apos;s own text size. SteinHub restarts to apply it.
          </Txt>
        </View>
      }
    >
      <View style={choiceStyles.list}>
        {(Object.keys(TEXT_SIZE_LABELS) as TextSize[]).map((choice) => {
          const ratio = TEXT_SCALES[choice] / textScale;
          return (
            <Choice key={choice} label={TEXT_SIZE_LABELS[choice]} selected={textSize === choice} onPress={() => void choose(choice)}>
              <Text style={[styles.sample, { fontSize: type.callout.fontSize * ratio, lineHeight: type.callout.lineHeight * ratio }]}>{TEXT_SIZE_LABELS[choice]}</Text>
            </Choice>
          );
        })}
      </View>
    </SheetContent>
  );
}

const styles = StyleSheet.create({
  sample: { color: colors.text, fontWeight: "400" },
});
