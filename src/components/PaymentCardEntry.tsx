import { useState, type FormEvent } from "react";
import { CreditCard, Loader2, LockKeyhole } from "lucide-react";

import { CARD_HOLDER_MAX, CARD_POSTAL_MAX, validCardNumber } from "../../shared/payment-cards";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, type Bot, type Message } from "@/state/store";
import { ASK_FIELD, askPrimary, AskCard, returnFocusToComposer } from "./AskCard";

// Security: what is typed goes straight to the server, never into the chat, and is cleared once sent.

/** A bot's card-entry ask: adding a card here approves that one payment, and saves the card to the Vault if chosen. */
export function PaymentCardEntry({ message, threadId, color }: { message: Message; threadId: string; color?: Bot["color"] }) {
  const card = message.card!;
  const request = card.paymentRequest!;
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [holder, setHolder] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [save, setSave] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const exp = /^\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*$/u.exec(expiry);
    if (!validCardNumber(number)) { setError(t("settings.vault.card.numberError")); return; }
    if (!exp) { setError(t("settings.vault.card.expiryError")); return; }
    setPending(true);
    setError(null);
    try {
      await api(`/api/threads/${encodeURIComponent(threadId)}/payment-card`, {
        method: "POST",
        body: JSON.stringify({
          requestId: card.requestId, number, expMonth: Number(exp[1]), expYear: Number(exp[2]), save,
          ...(cvc.trim() ? { cvc: cvc.trim() } : {}), ...(holder.trim() ? { holder: holder.trim() } : {}), ...(postalCode.trim() ? { postalCode: postalCode.trim() } : {}),
        }),
      });
      setNumber("");
      setCvc("");
      returnFocusToComposer();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t("settings.vault.card.saveError"));
    } finally {
      setPending(false);
    }
  };

  const decline = () => {
    void api(`/api/threads/${encodeURIComponent(threadId)}/respond`, { method: "POST", body: JSON.stringify({ requestId: card.requestId, behavior: "deny" }) }).catch(() => {});
  };

  return (
    <AskCard ariaLabel={card.title} icon={<CreditCard size={15} />} title={card.title} explanation={card.subtitle}
      onDismiss={decline} dismissLabel={t("mcp.cancel")} stays>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2" data-payment-entry>
        <input name="cardNumber" type="password" inputMode="numeric" autoComplete="off" spellCheck={false} dir="ltr" maxLength={23} value={number}
          onChange={(event) => setNumber(event.target.value)} placeholder={t("settings.vault.card.number")} aria-label={t("settings.vault.card.number")}
          disabled={pending} className={cn(ASK_FIELD, "w-full")} />
        <div className="flex flex-wrap gap-2">
          <input name="cardExpiry" type="text" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={7} value={expiry} placeholder="MM/YY"
            onChange={(event) => setExpiry(event.target.value)} aria-label={t("settings.vault.card.expiry")} disabled={pending} className={cn(ASK_FIELD, "min-w-[6rem] flex-1")} />
          <input name="cardCvc" type="password" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={4} value={cvc} placeholder={t("settings.vault.card.cvc")}
            onChange={(event) => setCvc(event.target.value)} aria-label={t("settings.vault.card.cvc")} disabled={pending} className={cn(ASK_FIELD, "min-w-[6rem] flex-1")} />
        </div>
        <div className="flex flex-wrap gap-2">
          <input name="cardHolder" type="text" autoComplete="off" maxLength={CARD_HOLDER_MAX} value={holder} placeholder={t("settings.vault.card.holder")}
            onChange={(event) => setHolder(event.target.value)} aria-label={t("settings.vault.card.holder")} disabled={pending} className={cn(ASK_FIELD, "min-w-[10rem] flex-[2]")} />
          <input name="cardPostal" type="text" autoComplete="off" dir="ltr" maxLength={CARD_POSTAL_MAX} value={postalCode} placeholder={t("payment.entry.postal")}
            onChange={(event) => setPostalCode(event.target.value)} aria-label={t("settings.vault.card.postal")} disabled={pending} className={cn(ASK_FIELD, "min-w-[6rem] flex-1")} />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" name="saveCard" checked={save} onChange={(event) => setSave(event.target.checked)} disabled={pending} />
          {t("payment.entry.save")}
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-[12px] text-ink-tertiary"><LockKeyhole size={11} /> {t("payment.entry.private")}</span>
          <button type="submit" disabled={pending || !number.trim() || !expiry.trim()} {...askPrimary(color)}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : <LockKeyhole size={14} />}
            {t("payment.pay", { amount: request.amount })}
          </button>
        </div>
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </form>
    </AskCard>
  );
}
