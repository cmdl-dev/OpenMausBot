import { useId, useMemo, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { SETTINGS_INPUT, SettingsFormFoot, SettingsGroup, SettingsRows, SettingsTag, Switch } from "../SettingsPrimitives";
import {
  CALL_PLACEHOLDERS, CALL_PROMPT_KEYS, PLACEHOLDER_MEANING, PROMPT_LABEL, PROMPT_ROLE, promptDraftFrom, promptsPatch, type CallPromptKey, type CallsSetupStatus,
  type PromptDraft,
} from "./calls-settings";
import { useCallsSwitch } from "./use-calls-switch";
import { useSavedDraft } from "./use-saved-draft";

const MAX_ROWS = 16;

export const PRE = "max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink/[0.045] px-3 py-2 font-mono text-[12px] leading-[18px] text-ink";

function SpeakDisclosure({ on, saving, error, toggle, record }: ReturnType<typeof useCallsSwitch> & { record: boolean }) {
  const labelId = useId();
  return (
    <div data-calls-speak-disclosure-row="" className="flex flex-col gap-1">
      <div className="flex min-h-7 items-center gap-3">
        <span id={labelId} className="text-[13px] leading-[18px] text-ink">{t("settings.calls.speakDisclosure")}</span>
        <Switch checked={on} disabled={saving} data-calls-speak-disclosure="" aria-labelledby={labelId} className="ms-auto" onClick={() => void toggle()} />
      </div>
      {!on && record && <p data-calls-disclosure-recorded="" className="text-[12px] leading-4 text-ink-secondary">{t("settings.calls.speakDisclosureRecorded")}</p>}
      {error && <span role="alert" className="text-[12px] leading-4 text-danger">{error}</span>}
    </div>
  );
}

export function CallPrompts({ setup, onSaved }: { setup: CallsSetupStatus; onSaved: () => Promise<unknown> }) {
  const { dispatch } = useStore();
  const latest = useMemo(() => promptDraftFrom(setup), [setup]);
  const { saved, draft, edit, markSaved } = useSavedDraft<PromptDraft>(latest);
  const speak = useCallsSwitch("disclosureEnabled", setup.disclosureEnabled !== false, onSaved);
  const sendable: PromptDraft = speak.on ? draft : { ...draft, disclosure: saved.disclosure };
  const [invalid, setInvalid] = useState<Partial<Record<CallPromptKey, LocaleKey>>>({});
  const [busy, setBusy] = useState<CallPromptKey | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const formId = useId();
  const dirty = CALL_PROMPT_KEYS.some((key) => sendable[key] !== saved[key]);

  const put = async (calls: Partial<Record<CallPromptKey, string | null>>, after: Partial<PromptDraft>) => {
    setNotice(null);
    setError(null);
    try {
      const config: ConfigStatus = await api("/api/config", { method: "PUT", body: JSON.stringify({ calls }) });
      dispatch({ type: "configStatus", config });
      markSaved(after);
      setNotice(t("settings.calls.saved"));
      void onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.calls.saveFailed"));
    }
  };

  const save = async () => {
    const patch = promptsPatch(sendable, saved);
    if (!patch.ok) { setInvalid(patch.invalid); return; }
    setInvalid({});
    const changed = Object.keys(patch.calls) as CallPromptKey[];
    if (!changed.length) return;
    setBusy("save");
    const after = Object.fromEntries(changed.map((key) => [key, patch.calls[key] ?? setup.prompts[key].default]));
    await put(patch.calls, after);
    setBusy(null);
  };

  const reset = async (key: CallPromptKey) => {
    setBusy(key);
    setInvalid({ ...invalid, [key]: undefined });
    await put({ [key]: null }, { [key]: setup.prompts[key].default });
    setBusy(null);
  };

  return <>
    <SettingsGroup label={t("settings.calls.prompts")} block="calls-prompts" description={t("settings.calls.promptsLine")}>
      <SettingsRows>
        <form id={formId} noValidate data-calls-prompts="" className="flex flex-col gap-5 px-4 pb-1 pt-3"
          onSubmit={(event) => { event.preventDefault(); if (!busy) void save(); }}>
          {CALL_PROMPT_KEYS.map((key) => {
            const wrong = invalid[key];
            const custom = setup.prompts[key].custom;
            const silenced = key === "disclosure" && !speak.on;
            return (
              <div key={key} data-calls-prompt={key} className="flex flex-col gap-1.5">
                <div className="flex min-h-7 items-center gap-2">
                  <label htmlFor={`${formId}-${key}`} className="text-[13px] font-medium leading-[18px] text-ink">{t(PROMPT_LABEL[key])}</label>
                  <span data-calls-prompt-state={custom ? "custom" : "default"}><SettingsTag>{t(custom ? "settings.calls.promptCustom" : "settings.calls.promptDefault")}</SettingsTag></span>
                  {custom && (
                    <button type="button" data-calls-prompt-reset={key} disabled={busy !== null || silenced} onClick={() => void reset(key)}
                      className="ui-button ui-button-sm ms-auto rounded-full">
                      {busy === key ? t("settings.calls.resetting") : t("settings.calls.resetPrompt")}
                    </button>
                  )}
                </div>
                <p id={`${formId}-${key}-role`} className="text-[12px] leading-4 text-ink-secondary">{t(PROMPT_ROLE[key])}</p>
                {key === "disclosure" && <SpeakDisclosure {...speak} record={setup.record !== false} />}
                <textarea id={`${formId}-${key}`} name={key} value={silenced ? saved[key] : draft[key]} disabled={busy !== null || silenced} dir="auto" spellCheck={false} autoComplete="off"
                  aria-describedby={`${formId}-${key}-role`} aria-invalid={Boolean(wrong) || undefined}
                  rows={Math.min(MAX_ROWS, Math.max(2, draft[key].split("\n").length + 1))}
                  onChange={(event) => { edit({ [key]: event.target.value }); setNotice(null); }}
                  className={cn(SETTINGS_INPUT, "h-auto resize-y py-1.5 font-mono text-[12px] leading-[18px]", wrong && "border-danger/60")} />
                {wrong && <span role="alert" className="text-[12px] leading-4 text-danger">{t(wrong)}</span>}
              </div>
            );
          })}
        </form>
        <SettingsFormFoot status={error ? <span role="alert" className="text-danger">{error}</span> : notice ? <span role="status">{notice}</span> : undefined}>
          <button type="submit" form={formId} data-calls-prompts-save="" disabled={busy !== null || !dirty} className="ui-button ui-button-md ui-button-primary rounded-full">
            {busy === "save" ? t("common.saving") : t("common.save")}
          </button>
        </SettingsFormFoot>
      </SettingsRows>
    </SettingsGroup>
    <SettingsGroup label={t("settings.calls.placeholders")} block="calls-placeholders">
      <SettingsRows>
        <dl data-calls-placeholders="" className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3 text-[13px] leading-[18px]">
          {CALL_PLACEHOLDERS.map(({ name, meaning }) => {
            const key = PLACEHOLDER_MEANING[name];
            return <div key={name} className="contents">
              <dt><code className="font-mono text-[12px] text-ink">{`{${name}}`}</code></dt>
              <dd className="text-ink-secondary">{key ? t(key) : meaning}</dd>
            </div>;
          })}
        </dl>
      </SettingsRows>
    </SettingsGroup>
    <SettingsGroup label={t("settings.calls.tools")} block="calls-tools" description={t("settings.calls.toolsLine")}>
      <SettingsRows>
        <div className="px-4 py-3">
          <pre data-calls-tools="" tabIndex={0} aria-label={t("settings.calls.tools")} dir="ltr" className={PRE}>{JSON.stringify(setup.tools, null, 2)}</pre>
        </div>
      </SettingsRows>
    </SettingsGroup>
  </>;
}
