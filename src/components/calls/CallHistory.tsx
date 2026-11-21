import { useCallback, useEffect, useId, useState } from "react";
import { AudioLines, ChevronRight, Download } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/state/store";
import { intlLocale, t } from "@/lib/i18n";
import { localizedRelativeTime } from "@/lib/relative-time";
import { sizeText } from "@/lib/attach-notice";
import { ConfirmDialog } from "../ConfirmDialog";
import { SettingsEmptyRow, SettingsFoldRow, SettingsGroup, SettingsRows } from "../SettingsPrimitives";
import { SettingsSkeletonRows } from "../settings/SettingsStates";
import { PRE } from "./CallPrompts";
import {
  CALLS_PATH, EAGERNESS_LABEL, END_TEXT, NOISE_REDUCTION_LABEL, PROMPT_LABEL, REASONING_LABEL, TURN_TYPE_LABEL, callOngoing, clockLength, lineOffset, recordingDownloadUrl,
  type CallDetail, type CallLine, type CallRecording, type CallSent, type CallSummary, type CallTurnDetection,
} from "./calls-settings";

const LIVE_POLL_MS = 4_000;

function outcome(call: CallSummary): string {
  if (call.phase === "ended") return call.endReason ? t(END_TEXT[call.endReason]) : t("settings.calls.phase.ended");
  return t(call.phase === "in_progress" ? "settings.calls.phase.live" : call.phase === "ringing" ? "settings.calls.phase.ringing" : "settings.calls.phase.dialing");
}

export function CallHistory() {
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback((background = false) => api<{ calls: CallSummary[] }>(CALLS_PATH, { background })
    .then((answer) => { setCalls(Array.isArray(answer.calls) ? answer.calls : []); setError(null); })
    .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t("settings.calls.historyFailed"))), []);

  useEffect(() => { void load(); }, [load]);
  const live = calls?.some(callOngoing) ?? false;
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => void load(true), LIVE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, load]);

  return (
    <SettingsGroup label={t("settings.calls.history")} block="calls-history">
      <SettingsRows>
        {!calls && !error && <SettingsSkeletonRows />}
        {error && (
          <div role="alert" className="flex min-h-11 items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1 text-[13px] leading-[18px] text-danger">{error}</span>
            <button type="button" className="ui-button shrink-0" onClick={() => void load()}>{t("settings.state.tryAgain")}</button>
          </div>
        )}
        {calls && calls.length === 0 && <SettingsEmptyRow>{t("settings.calls.empty")}</SettingsEmptyRow>}
        {calls?.map((call) => (
          <SettingsFoldRow key={call.id} id={`call-${call.id}`} open={open === call.id} onToggle={() => setOpen(open === call.id ? null : call.id)}
            title={call.calleeName ? `${call.calleeName} · ${call.to}` : call.to}
            subtitle={<span data-call-row={call.id}>{[call.botName, localizedRelativeTime(call.createdAt, intlLocale()), outcome(call)].join(" · ")}</span>}
            value={<span className="flex items-center gap-1.5">
              {call.recorded && <AudioLines size={14} data-call-recorded="" role="img" aria-label={t("settings.calls.recorded")} className="text-ink-tertiary" />}
              <span className="tabular-nums">{clockLength(call.seconds)}</span>
            </span>}>
            <CallDetailRows id={call.id} onChanged={() => void load(true)} onDeleted={() => {
              setOpen(null);
              setCalls((current) => current?.filter((each) => each.id !== call.id) ?? null);
              void load(true);
            }} />
          </SettingsFoldRow>
        ))}
      </SettingsRows>
    </SettingsGroup>
  );
}

function CallDetailRows({ id, onChanged, onDeleted }: { id: string; onChanged: () => void; onDeleted: () => void }) {
  const [call, setCall] = useState<CallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hangingUp, setHangingUp] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const path = `${CALLS_PATH}/${encodeURIComponent(id)}`;

  const load = useCallback((background = false) => api<CallDetail>(path, { background })
    .then((next) => { setCall(next); setError(null); })
    .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t("settings.calls.detailFailed"))), [path]);

  useEffect(() => { void load(); }, [load]);
  const ongoing = call ? callOngoing(call) : false;
  useEffect(() => {
    if (!ongoing) return;
    const timer = window.setInterval(() => void load(true), LIVE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [ongoing, load]);

  const hangUp = async () => {
    setHangingUp(true);
    setError(null);
    try {
      await api(`${path}/hang-up`, { method: "POST" });
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.calls.hangUpFailed"));
    } finally { setHangingUp(false); }
  };

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api(path, { method: "DELETE" });
      setConfirming(false);
      onDeleted();
    } catch (cause) {
      setConfirming(false);
      setError(cause instanceof Error ? cause.message : t("settings.calls.deleteFailed"));
    } finally { setDeleting(false); }
  };

  if (!call) {
    return error
      ? <p role="alert" className="px-4 py-3 text-[13px] leading-[18px] text-danger">{error}</p>
      : <SettingsSkeletonRows />;
  }
  const callee = call.calleeName ?? call.to;
  return (
    <div data-call-detail={call.id} className="flex flex-col gap-3 px-4 pb-4 pt-3">
      <section className="flex flex-col gap-1">
        <h4 className="text-[12px] font-medium leading-4 text-ink-tertiary">{t("settings.calls.brief")}</h4>
        <p dir="auto" className="whitespace-pre-wrap text-[13px] leading-[18px] text-ink">{call.brief}</p>
      </section>
      <section className="flex flex-col gap-1">
        <h4 className="text-[12px] font-medium leading-4 text-ink-tertiary">{t("settings.calls.transcript")}</h4>
        {call.transcript.length === 0
          ? <p className="text-[13px] leading-[18px] text-ink-secondary">{t("settings.calls.noTranscript")}</p>
          : <ol data-call-transcript="" className="flex flex-col gap-2">
            {call.transcript.map((line, index) => <TranscriptLine key={index} call={call} line={line} callee={callee} />)}
          </ol>}
      </section>
      {call.recording && <RecordingSection key={call.recording.url} recording={call.recording} />}
      {call.sent && <SentSection sent={call.sent} />}
      <div className="flex items-center justify-end gap-3">
        {error && <span role="alert" className="me-auto min-w-0 text-[12px] leading-4 text-danger">{error}</span>}
        {ongoing
          ? <button type="button" data-call-hang-up="" disabled={hangingUp} onClick={() => void hangUp()} className="ui-button ui-button-md rounded-full">
            {hangingUp ? t("server.calls.card.hangingUp") : t("server.calls.card.hangUp")}
          </button>
          : <button type="button" data-call-delete="" disabled={deleting} onClick={() => setConfirming(true)} className="ui-button ui-button-md rounded-full text-danger">
            {t("settings.calls.delete")}
          </button>}
      </div>
      <ConfirmDialog open={confirming} title={t("settings.calls.deleteTitle")} body={t("settings.calls.deleteBody")}
        confirmLabel={deleting ? t("settings.calls.deleting") : t("settings.calls.delete")} pending={deleting}
        onCancel={() => setConfirming(false)} onConfirm={() => void remove()} />
    </div>
  );
}

function TranscriptLine({ call, line, callee }: { call: CallDetail; line: CallLine; callee: string }) {
  const at = <span className="shrink-0 text-[12px] leading-[18px] tabular-nums text-ink-tertiary">{lineOffset(call, line.at)}</span>;
  if (line.speaker === "note") {
    return (
      <li data-speaker="note" className="flex gap-3">
        {at}
        <span dir="auto" className="min-w-0 text-[12px] leading-[18px] text-ink-tertiary">{line.text}</span>
      </li>
    );
  }
  return (
    <li data-speaker={line.speaker} className="flex gap-3">
      {at}
      <span className="min-w-0 text-[13px] leading-[18px]">
        <span className="font-semibold text-ink-secondary">{line.speaker === "bot" ? call.botName : callee}</span>{" "}
        <span dir="auto" className="text-ink">{line.text}</span>
        {line.cut && <span data-call-cut="" role="img" aria-label={t("settings.calls.cut")} title={t("settings.calls.cut")} className="text-ink-tertiary">…</span>}
      </span>
    </li>
  );
}

function RecordingSection({ recording }: { recording: CallRecording }) {
  const [broken, setBroken] = useState(false);
  return (
    <section data-call-recording="" className="flex flex-col gap-1">
      <h4 className="text-[12px] font-medium leading-4 text-ink-tertiary">{t("settings.calls.recording")}</h4>
      {broken
        ? <p data-call-recording-unavailable="" className="text-[13px] leading-[18px] text-ink-secondary">{t("settings.calls.recordingUnavailable")}</p>
        : <>
          <audio src={recording.url} controls preload="metadata" aria-label={t("settings.calls.recording")} onError={() => setBroken(true)} className="h-9 w-full" />
          <div className="flex items-center gap-3 text-[12px] leading-4 text-ink-tertiary">
            <span className="tabular-nums">{clockLength(recording.seconds)} · {sizeText(recording.bytes)}</span>
            <a href={recordingDownloadUrl(recording.url)} download data-call-recording-download=""
              className="ms-auto inline-flex items-center gap-1 rounded-md text-accent-text hover:underline">
              <Download size={14} aria-hidden="true" />{t("attach.download")}
            </a>
          </div>
        </>}
    </section>
  );
}

const SENT_TEXTS = ["disclosure", "instructions", "opening", "closing", "wrapUp", "goodbye"] as const;

function turnDetectionText(detection: CallTurnDetection): string {
  const parts = [t(TURN_TYPE_LABEL[detection.type])];
  if (detection.threshold !== undefined) parts.push(`${t("settings.calls.threshold")} ${detection.threshold}`);
  if (detection.prefixPaddingMs !== undefined) parts.push(`${t("settings.calls.prefixPadding")} ${detection.prefixPaddingMs}`);
  if (detection.silenceDurationMs !== undefined) parts.push(`${t("settings.calls.silence")} ${detection.silenceDurationMs}`);
  if (detection.eagerness) parts.push(`${t("settings.calls.eagerness")} ${t(EAGERNESS_LABEL[detection.eagerness])}`);
  return parts.join(" · ");
}

function SentSection({ sent }: { sent: CallSent }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const values: Array<[string, string]> = [
    [t("settings.calls.model"), sent.model],
    [t("settings.calls.voice"), sent.voice],
    ...(sent.reasoningEffort ? [[t("settings.calls.reasoningEffort"), t(REASONING_LABEL[sent.reasoningEffort])] as [string, string]] : []),
    [t("settings.calls.transcriptionModel"), sent.transcriptionModel],
    [t("settings.calls.turnDetection"), turnDetectionText(sent.turnDetection)],
    [t("settings.calls.noiseReduction"), t(NOISE_REDUCTION_LABEL[sent.noiseReduction])],
    [t("settings.calls.maxTurns"), String(sent.maxTurnsWithoutReply)],
    [t("settings.calls.maxMinutes"), String(sent.maxMinutes)],
  ];
  return (
    <section data-call-sent="" className="flex flex-col gap-2">
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}
        className="-mx-1 flex cursor-pointer items-center gap-1 self-start rounded-md px-1 text-[12px] font-medium leading-4 text-ink-tertiary hover:text-ink-secondary">
        <ChevronRight size={14} aria-hidden="true" className={cn("transition-transform duration-150 motion-reduce:transition-none rtl:-scale-x-100", open && "rotate-90")} />
        {t("settings.calls.sent")}
      </button>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-3">
        {SENT_TEXTS.filter((key) => sent[key] !== undefined).map((key) => (
          <div key={key} data-call-sent-text={key} className="flex flex-col gap-1">
            <h5 className="text-[12px] font-medium leading-4 text-ink-tertiary">{t(PROMPT_LABEL[key])}</h5>
            <pre tabIndex={0} aria-label={t(PROMPT_LABEL[key])} dir="auto" className={PRE}>{sent[key]}</pre>
          </div>
        ))}
        <dl data-call-sent-values="" className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px] leading-[18px]">
          {values.map(([label, value]) => <div key={label} className="contents">
            <dt className="text-ink-tertiary">{label}</dt>
            <dd className="min-w-0 break-words text-ink">{value}</dd>
          </div>)}
        </dl>
        <div className="flex flex-col gap-1">
          <h5 className="text-[12px] font-medium leading-4 text-ink-tertiary">{t("settings.calls.session")}</h5>
          <pre data-call-sent-session="" tabIndex={0} aria-label={t("settings.calls.session")} dir="ltr" className={PRE}>{JSON.stringify(sent.session, null, 2)}</pre>
        </div>
      </div>
    </section>
  );
}
