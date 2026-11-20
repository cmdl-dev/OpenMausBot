// The live card a call keeps in its conversation: dialing, ringing, on the call, ended, with Hang up while it runs.
import { CALL_END_TEXT, type CallEndReason } from "../../shared/phone-calls.ts";
import type { WidgetText } from "../../shared/widget-text.ts";
import { WIDGET_LIMITS, type WidgetRoot } from "../../shared/widget.ts";
import type { ServerLineKey } from "../server-lines.ts";
import type { CallRecord } from "./manager.ts";

type Node = Record<string, unknown>;

export const HANG_UP_ACTION = "call_hang_up";

export const CALL_END_LINE = {
  completed: "server.calls.end.completed", hung_up: "server.calls.end.hung_up", no_answer: "server.calls.end.no_answer", busy: "server.calls.end.busy",
  failed: "server.calls.end.failed", voicemail: "server.calls.end.voicemail", max_length: "server.calls.end.max_length",
  canceled: "server.calls.end.canceled", lost: "server.calls.end.lost", error: "server.calls.end.error",
} as const satisfies Record<CallEndReason, ServerLineKey>;

const words = (key: ServerLineKey, params?: WidgetText["params"]): WidgetText => ({ key, ...(params ? { params } : {}) });
const clip = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);
const text = (value: string, said?: WidgetText, weight?: "medium"): Node => ({ type: "Text", value: clip(value, WIDGET_LIMITS.text), ...(weight ? { weight } : {}), ...(said ? { i18n: { value: said } } : {}) });
const caption = (value: string, said?: WidgetText): Node => ({ type: "Caption", value: clip(value, 160), ...(said ? { i18n: { value: said } } : {}) });

function status(record: CallRecord, minutes: number): Node {
  const number = record.to;
  switch (record.phase) {
    case "dialing": return text(`Dialing ${number}…`, words("server.calls.card.dialing", { number }), "medium");
    case "ringing": return text(`Ringing ${number}…`, words("server.calls.card.ringing", { number }), "medium");
    case "in_progress": return text(`On the call with ${number} · ${minutes} min`, words("server.calls.card.live", { number, minutes }), "medium");
    default: {
      const reason: CallEndReason = record.endReason ?? "completed";
      return record.answeredAt
        ? text(`Ended after ${minutes} min. ${CALL_END_TEXT[reason]}`, words("server.calls.card.ended", { minutes, reason: words(CALL_END_LINE[reason]) }), "medium")
        : text(CALL_END_TEXT[reason], words(CALL_END_LINE[reason]), "medium");
    }
  }
}

export function callCard(record: CallRecord, minutes: number): WidgetRoot {
  const goal = record.brief.split("\n")[0]!.replace(/\s+/g, " ").trim();
  const children: Node[] = [status(record, minutes), ...(goal ? [caption(goal)] : [])];
  if (record.phase === "ended" && record.endDetail && (record.endReason === "failed" || record.endReason === "error" || record.endReason === "lost")) children.push(caption(record.endDetail));
  if (record.phase !== "ended") {
    children.push(record.hangingUp
      ? caption("Hanging up…", words("server.calls.card.hangingUp"))
      : { type: "Row", gap: 2, wrap: true, children: [{ type: "Button", label: "Hang up", style: "secondary", onClickAction: { type: HANG_UP_ACTION, payload: { callId: record.id } }, i18n: { label: words("server.calls.card.hangUp") } }] });
  }
  const who = record.calleeName ? `${record.calleeName} · ${record.to}` : record.to;
  return {
    type: "Card", id: "root", title: "Phone call", caption: clip(who, WIDGET_LIMITS.caption), children,
    i18n: { title: words("server.calls.card.title") },
  } as unknown as WidgetRoot;
}
