import { Plus } from "lucide-react";

import { t } from "@/lib/i18n";
import { type Bot } from "@/state/store";
import { Card, LinkRow, NoteRow } from "./rows";

export function BrowserLogins({ bot, browserEnabled, onOpenBrowser }: {
  bot: Bot;
  browserEnabled: boolean;
  onOpenBrowser: () => void;
}) {
  const temporary = bot.browserProfile === "guest";

  return (
    <Card anchor="logins">
      {!browserEnabled ? (
        <NoteRow>{t("botSettings.simple.loginsOff", { name: bot.name })}</NoteRow>
      ) : temporary ? (
        <NoteRow>{t("settings.profiles.temporaryHint")}</NoteRow>
      ) : (
        <>
          <NoteRow>{t("botSettings.simple.loginsHint", { name: bot.name })}</NoteRow>
          <LinkRow data-panel-action="add-login" icon={Plus} onClick={onOpenBrowser}>{t("botSettings.simple.addLogin")}</LinkRow>
        </>
      )}
    </Card>
  );
}
