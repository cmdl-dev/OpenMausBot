import { useCallback, useEffect, useId, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { SETTINGS_INPUT, SettingRow, SettingsField, SettingsFormFoot, SettingsGroup, SettingsLinkRow, SettingsRows, StatusDot } from "../SettingsPrimitives";
import { SettingsSkeletonRows } from "../settings/SettingsStates";
import { keyEntry, savedState, type KeyId } from "../keys/key-catalog";
import { openKeySettings } from "../keys/key-focus";
import { CallHistory } from "./CallHistory";
import { CALLS_PATH, SETTING_LABEL, callsPatch, draftFrom, type CallsDraft, type CallsSetupStatus, type DraftField } from "./calls-settings";

const KEYS: readonly KeyId[] = ["twilioSid", "twilioToken", "openai"];

export function PhoneCallsSettings() {
  const [setup, setSetup] = useState<CallsSetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    setError(null);
    return api<CallsSetupStatus>(`${CALLS_PATH}/setup`, { signal })
      .then((next) => { if (!signal?.aborted) setSetup(next); })
      .catch((cause: unknown) => { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : t("settings.calls.loadFailed")); });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return <>
    <SettingsGroup label={t("settings.calls.title")} block="calls" description={t("settings.calls.line")}>
      <SettingsRows>
        {!setup && !error && <SettingsSkeletonRows />}
        {error && (
          <SettingRow title={t("settings.calls.loadFailed")} message={<span role="alert" className="text-danger">{error}</span>}>
            <button type="button" className="ui-button" onClick={() => void load()}>{t("settings.state.tryAgain")}</button>
          </SettingRow>
        )}
        {setup && <SetupRows setup={setup} />}
        <KeyRows />
      </SettingsRows>
    </SettingsGroup>
    {setup && <CallsForm setup={setup} onSaved={() => void load()} />}
    <CallHistory />
  </>;
}

function SetupRows({ setup }: { setup: CallsSetupStatus }) {
  return <>
    <SettingRow title={t("settings.calls.status")}
      subtitle={<span role="status" data-calls-ready={setup.ready ? "" : undefined} className="flex items-center">
        <StatusDot tone={setup.ready ? "success" : "warning"} />{t(setup.ready ? "settings.calls.ready" : "settings.calls.notReady")}
      </span>}>{null}</SettingRow>
    {setup.missing.map((setting) => (
      <SettingRow key={setting.id} title={t(SETTING_LABEL[setting.id])}
        subtitle={<span data-calls-missing={setting.id}>{t("settings.calls.missingEnv").split("{env}").flatMap((part, index) =>
          index === 0 ? [part] : [<code key={index} className="font-mono text-[12px]">{setting.env}</code>, part])}</span>}>{null}</SettingRow>
    ))}
    {setup.problems.map((problem) => (
      <p key={problem} role="alert" data-calls-problem="" dir="auto" className="px-4 py-3 text-[13px] leading-[18px] text-danger">{problem}</p>
    ))}
    <SettingRow title={t("settings.calls.exposeTitle")}
      subtitle={<span data-calls-expose="">{t("settings.calls.exposeLine", { port: setup.port, path: `${setup.publicUrl ?? "https://…"}/calls/twilio/*` })}</span>}
      message={setup.listening ? undefined : t("settings.calls.notListening")}>
      <code className="font-mono text-[13px] tabular-nums text-ink">{setup.port}</code>
    </SettingRow>
  </>;
}

function KeyRows() {
  const { state, dispatch } = useStore();
  return <>
    {KEYS.map((id) => {
      const entry = keyEntry(id);
      const saved = savedState(entry, state.config).configured;
      return (
        <SettingsLinkRow key={id} title={t(entry.labelKey)} data={{ "data-calls-key": id }} onClick={() => dispatch(openKeySettings(id))}
          value={<span className="flex items-center"><StatusDot tone={saved ? "success" : null} />{t(saved ? "keys.connected" : "settings.calls.keyMissing")}</span>} />
      );
    })}
  </>;
}

const FIELDS: ReadonlyArray<{ field: DraftField; label: LocaleKey; hint?: LocaleKey; placeholder?: string; lines?: boolean; type?: string }> = [
  { field: "callerId", label: "settings.calls.callerId", hint: "settings.calls.callerIdHint", placeholder: "+14155550123", type: "tel" },
  { field: "publicUrl", label: "settings.calls.publicUrl", hint: "settings.calls.publicUrlHint", placeholder: "https://calls.example.com", type: "url" },
  { field: "maxMinutes", label: "settings.calls.maxMinutes", type: "number" },
  { field: "model", label: "settings.calls.model" },
  { field: "voice", label: "settings.calls.voice" },
  { field: "onBehalfOf", label: "settings.calls.onBehalfOf", hint: "settings.calls.onBehalfOfHint" },
  { field: "allow", label: "settings.calls.allow", hint: "settings.calls.allowHint", placeholder: "+1415*", lines: true },
  { field: "deny", label: "settings.calls.deny", hint: "settings.calls.denyHint", placeholder: "+1900*", lines: true },
];

function CallsForm({ setup, onSaved }: { setup: CallsSetupStatus; onSaved: () => void }) {
  const { dispatch } = useStore();
  const [saved, setSaved] = useState<CallsDraft>(() => draftFrom(setup));
  const [draft, setDraft] = useState<CallsDraft>(saved);
  const [invalid, setInvalid] = useState<Partial<Record<DraftField, LocaleKey>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const formId = useId();

  useEffect(() => {
    const next = draftFrom(setup);
    setSaved(next);
    setDraft(next);
  }, [setup]);

  const dirty = (Object.keys(draft) as DraftField[]).some((field) => draft[field].trim() !== saved[field].trim());

  const save = async () => {
    const patch = callsPatch(draft, saved);
    setNotice(null);
    setError(null);
    if (!patch.ok) { setInvalid(patch.invalid); return; }
    setInvalid({});
    if (!Object.keys(patch.calls).length) return;
    setSaving(true);
    try {
      const config: ConfigStatus = await api("/api/config", { method: "PUT", body: JSON.stringify({ calls: patch.calls }) });
      dispatch({ type: "configStatus", config });
      setSaved(draft);
      setNotice(t("settings.calls.saved"));
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.calls.saveFailed"));
    } finally { setSaving(false); }
  };

  return (
    <SettingsGroup label={t("settings.calls.settings")} block="calls-settings">
      <SettingsRows>
        <form id={formId} noValidate data-calls-form="" className="flex flex-col gap-4 px-4 pb-1 pt-3" onSubmit={(event) => { event.preventDefault(); if (!saving) void save(); }}>
          {FIELDS.map(({ field, label, hint, placeholder, lines, type }) => {
            const wrong = invalid[field];
            const shared = {
              name: field, value: draft[field], disabled: saving, placeholder, "aria-invalid": Boolean(wrong) || undefined, autoComplete: "off", spellCheck: false, dir: "auto",
              onChange: (event: { target: { value: string } }) => { setDraft({ ...draft, [field]: event.target.value }); setNotice(null); },
            };
            return (
              <SettingsField key={field} label={t(label)}
                hint={wrong ? <span role="alert" className="text-danger">{t(wrong)}</span> : hint ? t(hint) : undefined}>
                {lines
                  ? <textarea {...shared} rows={3} className={cn(SETTINGS_INPUT, "h-auto min-h-16 resize-y py-1.5", wrong && "border-danger/60")} />
                  : <input {...shared} type={type ?? "text"} {...(type === "number" ? { min: 1, max: 60, step: 1, inputMode: "numeric" as const } : {})}
                      className={cn(SETTINGS_INPUT, wrong && "border-danger/60")} />}
              </SettingsField>
            );
          })}
        </form>
        <SettingsFormFoot status={error ? <span role="alert" className="text-danger">{error}</span> : notice ? <span role="status">{notice}</span> : undefined}>
          <button type="submit" form={formId} data-calls-save="" disabled={saving || !dirty} className="ui-button ui-button-md ui-button-primary rounded-full">
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </SettingsFormFoot>
      </SettingsRows>
    </SettingsGroup>
  );
}
