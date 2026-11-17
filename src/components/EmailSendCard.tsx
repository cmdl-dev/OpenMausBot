import { Check, Circle, Mail, X } from "lucide-react";

import { emailDraftOf, type EmailDraft } from "@/lib/email-send";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { Message } from "@/state/store";
import { ToolActivity } from "./ToolActivity";
import { WorkingDots } from "./WorkingIndicator";

type SendState = "sending" | "sent" | "failed" | "unconfirmed";

const STATE_WORDS: Record<SendState, LocaleKey> = {
  sending: "emailSend.sending",
  sent: "emailSend.sent",
  failed: "emailSend.failed",
  unconfirmed: "emailSend.unconfirmed",
};

function sendState(tool: NonNullable<Message["tool"]>, live: boolean): SendState {
  if (tool.ok === true) return "sent";
  if (tool.ok === false) return "failed";
  return live ? "sending" : "unconfirmed";
}

function AddressLine({ label, addresses }: { label: string; addresses: readonly string[] }) {
  if (!addresses.length) return null;
  const joined = addresses.join(", ");
  return (
    <div className="flex min-w-0 gap-2 text-[13px] leading-[18px]">
      <span className="shrink-0 text-ink-tertiary">{label}</span>
      <span dir="ltr" className="min-w-0 truncate text-ink-secondary" title={joined}>{joined}</span>
    </div>
  );
}

/** The email a bot sends with the Email connector: who it goes to, the subject and the body, then whether it went. */
export function EmailSendCard({ draft, tool, live = false }: { draft: EmailDraft; tool: NonNullable<Message["tool"]>; live?: boolean }) {
  const state = sendState(tool, live);
  const words = t(STATE_WORDS[state]);
  return (
    <section data-email-send={state} aria-label={t("emailSend.label", { subject: draft.subject || t("emailSend.noSubject") })}
      className="w-full max-w-[38rem] rounded-xl border border-hairline/40 bg-panel px-4 py-3">
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <Mail size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
        {t("email.title")}
      </div>
      <div className="mt-2 flex flex-col gap-1">
        <AddressLine label={t("emailSend.to")} addresses={draft.to} />
        <AddressLine label={t("emailSend.cc")} addresses={draft.cc} />
        <AddressLine label={t("emailSend.bcc")} addresses={draft.bcc} />
        <p dir="auto" className={cn("text-[13px] font-medium leading-[18px]", draft.subject ? "text-ink" : "text-ink-tertiary")}>
          {draft.subject || t("emailSend.noSubject")}
        </p>
      </div>
      <div tabIndex={0} aria-label={t("emailSend.body")} dir="auto"
        className="mt-2 max-h-80 overflow-auto border-t border-hairline/40 pt-2 text-[13px] leading-[18px] whitespace-pre-wrap break-words text-ink">
        {draft.text}
        {draft.cut && <span className="block pt-1 text-ink-tertiary">{t("emailSend.cut")}</span>}
      </div>
      <div role="status" className={cn("mt-2 flex items-center gap-1.5 text-[12px] leading-4", state === "failed" ? "text-danger" : "text-ink-tertiary")}>
        {state === "sending" ? <WorkingDots size={3.5} /> : state === "sent" ? <Check size={14} className="text-success" aria-hidden="true" /> : state === "failed" ? <X size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
        {words}
        {state === "failed" && tool.problem && <span className="min-w-0 truncate" title={tool.problem}>· {tool.problem}</span>}
      </div>
    </section>
  );
}

/** A tool step in a transcript: the email itself for an Email connector send, else the step's chip. */
export function ToolStepRow({ message, ...step }: { message: Message } & Parameters<typeof ToolActivity>[0]) {
  const draft = emailDraftOf(message);
  return draft ? <EmailSendCard draft={draft} tool={step.tool} live={step.live} /> : <ToolActivity {...step} />;
}
