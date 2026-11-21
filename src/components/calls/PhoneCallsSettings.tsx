import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { intlLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { SETTINGS_INPUT, SettingRow, SettingsField, SettingsFormFoot, SettingsGroup, SettingsLinkRow, SettingsRows, StatusDot, Switch } from "../SettingsPrimitives";
import { SettingsSkeletonRows } from "../settings/SettingsStates";
import { keyEntry, savedState, type KeyId } from "../keys/key-catalog";
import { openKeySettings } from "../keys/key-focus";
import { Select } from "../Select";
import { CallHistory } from "./CallHistory";
import { CallPrompts } from "./CallPrompts";
import { useSavedDraft } from "./use-saved-draft";
import {
  CALL_REASONING_EFFORTS, CALLS_PATH, CUSTOM_MODEL, EAGERNESS, EAGERNESS_LABEL, MODEL_TAG, NOISE_REDUCTION, NOISE_REDUCTION_LABEL, NUMBER_RANGES, REALTIME_MODELS,
  REASONING_LABEL, SETTING_LABEL, TURN_TYPES, TURN_TYPE_LABEL, DEFAULT_REASONING_EFFORT, callsPatch, draftChanged, draftFrom, listedModel, modelPrices, onBehalfOfNudge,
  turnFieldShown, voiceOptions, type CallsDraft, type CallsSetupStatus, type DraftField,
} from "./calls-settings";

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
    {setup && <>
      <CallsForm setup={setup} onSaved={() => void load()} label={t("settings.calls.settings")} block="calls-settings" fields={CALLING_FIELDS}
        lead={<RecordRow record={setup.record !== false} onSaved={load} />} />
      <CallsForm setup={setup} onSaved={() => void load()} label={t("settings.calls.voiceGroup")} block="calls-voice" fields={VOICE_FIELDS} />
      <CallPrompts setup={setup} onSaved={() => void load()} />
    </>}
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

function RecordRow({ record, onSaved }: { record: boolean; onSaved: () => Promise<unknown> }) {
  const { dispatch } = useStore();
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const on = pending ?? record;

  const toggle = async () => {
    const next = !on;
    setPending(next);
    setError(null);
    try {
      const config: ConfigStatus = await api("/api/config", { method: "PUT", body: JSON.stringify({ calls: { record: next } }) });
      dispatch({ type: "configStatus", config });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.calls.saveFailed"));
    } finally { setPending(null); }
  };

  return (
    <SettingRow title={t("settings.calls.record")} subtitle={t("settings.calls.recordLine")}
      message={error ? <span role="alert" className="text-danger">{error}</span> : undefined}>
      <Switch checked={on} disabled={pending !== null} data-calls-record="" aria-label={t("settings.calls.record")} onClick={() => void toggle()} />
    </SettingRow>
  );
}

interface FieldSpec {
  field: DraftField;
  label: LocaleKey;
  hint?: LocaleKey | ((draft: CallsDraft, setup: CallsSetupStatus) => ReactNode);
  placeholder?: string;
  lines?: boolean;
  type?: "tel" | "url" | "number";
  options?: (draft: CallsDraft) => ReadonlyArray<{ value: string; label: string }>;
  change?: (value: string) => Partial<CallsDraft>;
  shown?: (draft: CallsDraft) => boolean;
}

const labelled = <T extends string>(values: readonly T[], labels: Record<T, LocaleKey>) => () => values.map((value) => ({ value, label: t(labels[value]) }));
const recommended = (option: string) => t("settings.calls.recommendedOption", { option });

function modelOptions() {
  return [
    ...REALTIME_MODELS.map(({ id, label }) => ({ value: id, label: MODEL_TAG[id] ? t("settings.calls.modelOption", { model: label, tag: t(MODEL_TAG[id]) }) : label })),
    { value: CUSTOM_MODEL, label: t("settings.calls.modelCustom") },
  ];
}

function modelPriceNote(draft: CallsDraft) {
  const model = draft.modelChoice === CUSTOM_MODEL ? undefined : listedModel(draft.modelChoice);
  if (!model) return undefined;
  return <span data-calls-model-price={model.id}><code className="font-mono">{model.id}</code> · {t("settings.calls.modelPrice", modelPrices(model, intlLocale()))}</span>;
}

function onBehalfOfHint(_draft: CallsDraft, setup: CallsSetupStatus) {
  const nudge = onBehalfOfNudge(setup);
  return <>
    {t("settings.calls.onBehalfOfHint")}
    {nudge && (
      <span data-calls-on-behalf-nudge={nudge} className={cn("mt-1 flex items-start gap-1.5", nudge === "standIn" ? "text-warning" : "text-ink-secondary")}>
        <TriangleAlert size={14} aria-hidden="true" className="mt-px shrink-0 text-warning" />
        <span>{t(nudge === "standIn" ? "settings.calls.onBehalfOfStandIn" : "settings.calls.onBehalfOfDefault", { name: setup.onBehalfOfDefault })}</span>
      </span>
    )}
  </>;
}

const CALLING_FIELDS: readonly FieldSpec[] = [
  { field: "callerId", label: "settings.calls.callerId", hint: "settings.calls.callerIdHint", placeholder: "+14155550123", type: "tel" },
  { field: "publicUrl", label: "settings.calls.publicUrl", hint: "settings.calls.publicUrlHint", placeholder: "https://calls.example.com", type: "url" },
  { field: "maxMinutes", label: "settings.calls.maxMinutes", type: "number" },
  { field: "onBehalfOf", label: "settings.calls.onBehalfOf", hint: onBehalfOfHint },
  { field: "allow", label: "settings.calls.allow", hint: "settings.calls.allowHint", placeholder: "+1415*", lines: true },
  { field: "deny", label: "settings.calls.deny", hint: "settings.calls.denyHint", placeholder: "+1900*", lines: true },
];

const VOICE_FIELDS: readonly FieldSpec[] = [
  {
    field: "modelChoice", label: "settings.calls.model", options: modelOptions, hint: modelPriceNote,
    change: (value) => (value === CUSTOM_MODEL ? { modelChoice: value } : { modelChoice: value, model: value }),
  },
  { field: "model", label: "settings.calls.modelCustom", hint: "settings.calls.modelCustomHint", shown: (draft) => draft.modelChoice === CUSTOM_MODEL },
  {
    field: "voice", label: "settings.calls.voice",
    options: (draft) => voiceOptions(draft.voice).map(({ value, recommended: best }) => ({ value, label: best ? recommended(value) : value })),
  },
  {
    field: "reasoningEffort", label: "settings.calls.reasoningEffort", hint: "settings.calls.reasoningEffortHint",
    options: () => CALL_REASONING_EFFORTS.map((value) => {
      const label = t(REASONING_LABEL[value]);
      return { value, label: value === DEFAULT_REASONING_EFFORT ? recommended(label) : label };
    }),
  },
  { field: "transcriptionModel", label: "settings.calls.transcriptionModel", hint: "settings.calls.transcriptionModelHint" },
  { field: "turnType", label: "settings.calls.turnDetection", hint: "settings.calls.turnDetectionHint", options: labelled(TURN_TYPES, TURN_TYPE_LABEL) },
  { field: "threshold", label: "settings.calls.threshold", hint: "settings.calls.thresholdHint", type: "number" },
  { field: "prefixPaddingMs", label: "settings.calls.prefixPadding", type: "number" },
  { field: "silenceDurationMs", label: "settings.calls.silence", type: "number" },
  { field: "eagerness", label: "settings.calls.eagerness", hint: "settings.calls.eagernessHint", options: labelled(EAGERNESS, EAGERNESS_LABEL) },
  { field: "noiseReduction", label: "settings.calls.noiseReduction", options: labelled(NOISE_REDUCTION, NOISE_REDUCTION_LABEL) },
  { field: "maxTurnsWithoutReply", label: "settings.calls.maxTurns", hint: "settings.calls.maxTurnsHint", type: "number" },
];

function CallsForm({ setup, onSaved, label, block, fields, lead }: {
  setup: CallsSetupStatus; onSaved: () => void; label: string; block: string; fields: readonly FieldSpec[]; lead?: ReactNode;
}) {
  const { dispatch } = useStore();
  const latest = useMemo(() => draftFrom(setup), [setup]);
  const { saved, draft, edit, markSaved } = useSavedDraft<CallsDraft>(latest);
  const [invalid, setInvalid] = useState<Partial<Record<DraftField, LocaleKey>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const formId = useId();

  const dirty = draftChanged(draft, saved);

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
      markSaved(draft);
      setNotice(t("settings.calls.saved"));
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.calls.saveFailed"));
    } finally { setSaving(false); }
  };

  return (
    <SettingsGroup label={label} block={block}>
      <SettingsRows>
        {lead}
        <form id={formId} noValidate data-calls-form={block} className="flex flex-col gap-4 px-4 pb-1 pt-3" onSubmit={(event) => { event.preventDefault(); if (!saving) void save(); }}>
          {fields.filter(({ field, shown }) => turnFieldShown(field, draft.turnType) && (shown?.(draft) ?? true)).map(({ field, label: fieldLabel, hint, placeholder, lines, type, options, change }) => {
            const wrong = invalid[field];
            const onChange = (event: { target: { value: string } }) => { edit(change ? change(event.target.value) : { [field]: event.target.value }); setNotice(null); };
            const shared = {
              name: field, value: draft[field], disabled: saving, placeholder, "aria-invalid": Boolean(wrong) || undefined, autoComplete: "off", spellCheck: false, dir: "auto", onChange,
            };
            const range = type === "number" ? NUMBER_RANGES[field as keyof typeof NUMBER_RANGES] : undefined;
            return (
              <SettingsField key={field} label={t(fieldLabel)}
                hint={wrong ? <span role="alert" className="text-danger">{t(wrong)}</span> : typeof hint === "function" ? hint(draft, setup) : hint ? t(hint) : undefined}>
                {options
                  ? <Select name={field} value={draft[field]} disabled={saving} onChange={onChange}>
                    {options(draft).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                  : lines
                    ? <textarea {...shared} rows={3} className={cn(SETTINGS_INPUT, "h-auto min-h-16 resize-y py-1.5", wrong && "border-danger/60")} />
                    : <input {...shared} type={type ?? "text"} {...(range ? { min: range.min, max: range.max, step: range.step, inputMode: range.whole ? "numeric" as const : "decimal" as const } : {})}
                        className={cn(SETTINGS_INPUT, wrong && "border-danger/60")} />}
              </SettingsField>
            );
          })}
        </form>
        <SettingsFormFoot status={error ? <span role="alert" className="text-danger">{error}</span> : notice ? <span role="status">{notice}</span> : undefined}>
          <button type="submit" form={formId} data-calls-save={block} disabled={saving || !dirty} className="ui-button ui-button-md ui-button-primary rounded-full">
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </SettingsFormFoot>
      </SettingsRows>
    </SettingsGroup>
  );
}
