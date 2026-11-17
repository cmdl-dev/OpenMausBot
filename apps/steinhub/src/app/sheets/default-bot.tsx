import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Avatar } from "@/components/avatar";
import { Choice, choiceStyles } from "@/components/choices";
import { SheetContent } from "@/components/sheet";
import { Txt } from "@/components/text";
import { setPreference, usePreferences } from "@/state/preferences";
import { useWorld } from "@/state/world";
import { space } from "@/theme";

/** The bot a new chat starts with. */
export default function DefaultBotSheet() {
  const world = useWorld();
  const { defaultBot } = usePreferences();
  const saved = defaultBot && world.bot(defaultBot) ? defaultBot : null;
  async function choose(id: string | null) {
    await setPreference("defaultBot", id);
    router.back();
  }
  return (
    <SheetContent
      label="Default bot"
      header={
        <View style={choiceStyles.header}>
          <Txt variant="headline">Default bot</Txt>
          <Txt variant="subhead" tone="secondary">
            A new chat starts with this bot.
          </Txt>
        </View>
      }
    >
      <View style={choiceStyles.list}>
        <Choice label="First in the list" detail={world.bots[0] ? `Now ${world.bots[0].name}` : undefined} selected={saved === null} onPress={() => void choose(null)} />
        {world.bots.map((bot) => (
          <Choice key={bot.id} label={bot.name} selected={saved === bot.id} onPress={() => void choose(bot.id)}>
            <View style={styles.bot}>
              <Avatar bot={bot} label={bot.glyph} tint={bot.tint} size="sm" />
              <Txt variant="callout">{bot.name}</Txt>
            </View>
          </Choice>
        ))}
      </View>
    </SheetContent>
  );
}

const styles = StyleSheet.create({
  bot: { flexDirection: "row", alignItems: "center", gap: space[3] },
});
