import { useCallback, useEffect, useState } from "react";
import { api } from "@/state/store";
import { intlLocale, t } from "@/lib/i18n";
import { localizedRelativeTime } from "@/lib/relative-time";
import { SettingsEmptyRow, SettingsFoldRow, SettingsGroup, SettingsRows } from "../SettingsPrimitives";
import { SettingsSkeletonRows } from "../settings/SettingsStates";
import { CALLS_PATH, END_TEXT, callOngoing, clockLength, lineOffset, type CallDetail, type CallLine, type CallSummary } from "./calls-settings";

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
            value={<span className="tabular-nums">{clockLength(call.seconds)}</span>}>
            <CallDetailRows id={call.id} onChanged={() => void load(true)} />
          </SettingsFoldRow>
        ))}
      </SettingsRows>
    </SettingsGroup>
  );
}

function CallDetailRows({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [call, setCall] = useState<CallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hangingUp, setHangingUp] = useState(false);
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
      {(ongoing || error) && (
        <div className="flex items-center justify-end gap-3">
          {error && <span role="alert" className="me-auto min-w-0 text-[12px] leading-4 text-danger">{error}</span>}
          {ongoing && (
            <button type="button" data-call-hang-up="" disabled={hangingUp} onClick={() => void hangUp()} className="ui-button ui-button-md rounded-full">
              {hangingUp ? t("server.calls.card.hangingUp") : t("server.calls.card.hangUp")}
            </button>
          )}
        </div>
      )}
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
      </span>
    </li>
  );
}
