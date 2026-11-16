import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "@/state/api";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { KEY_FIELD } from "./keys/KeyRow";

interface UsageHubView {
  id: string;
  label: string;
  url: string;
}

const INPUT = cn(KEY_FIELD, "font-sans");

/** CLIProxyAPI hubs (such as Router) whose connected Claude and Codex accounts Plan usage also lists. */
export function UsageHubs({ onChange }: { onChange: () => void }) {
  const [hubs, setHubs] = useState<UsageHubView[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("Router");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<{ hubs: UsageHubView[] }>("/api/plan-usage/hubs").then((answer) => setHubs(answer.hubs), () => setHubs([]));
  }, []);

  const failed = (cause: unknown) => setError(cause instanceof Error && cause.message ? cause.message : t("usageHubs.failed"));

  const add = async () => {
    if (busy || !url.trim() || !key.trim()) return;
    setBusy(true);
    setError("");
    try {
      const answer = await api<{ hubs: UsageHubView[] }>("/api/plan-usage/hubs", { method: "POST", body: JSON.stringify({ label, url, managementKey: key }) });
      setHubs(answer.hubs);
      setAdding(false);
      setUrl("");
      setKey("");
      onChange();
    } catch (cause) {
      failed(cause);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (hub: UsageHubView) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setHubs((await api<{ hubs: UsageHubView[] }>(`/api/plan-usage/hubs/${encodeURIComponent(hub.id)}`, { method: "DELETE" })).hubs);
      onChange();
    } catch (cause) {
      failed(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-usage-hubs className="mt-4 border-t border-hairline/30 pt-3">
      <div className="mb-0.5 text-[13px] font-medium leading-[18px] text-ink">{t("usageHubs.title")}</div>
      <p className="mb-2 text-[12px] leading-4 text-ink-secondary">{t("usageHubs.subtitle")}</p>
      {(hubs ?? []).map((hub) => (
        <div key={hub.id} className="flex items-center justify-between gap-2 py-1.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] leading-5 text-ink">{hub.label}</div>
            <div className="truncate text-[12px] leading-4 text-ink-secondary">{hub.url}</div>
          </div>
          <button type="button" onClick={() => void remove(hub)} disabled={busy} aria-label={t("usageHubs.remove", { name: hub.label })}
            title={t("usageHubs.remove", { name: hub.label })} className="ui-icon-button shrink-0 hover:bg-danger/10 hover:text-danger">
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      {adding ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("usageHubs.label")} aria-label={t("usageHubs.label")}
            spellCheck={false} disabled={busy} className={INPUT} />
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://router.example.ts.net:14443" aria-label={t("usageHubs.url")}
            spellCheck={false} disabled={busy} className={INPUT} />
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t("usageHubs.key")} aria-label={t("usageHubs.key")}
            autoComplete="off" disabled={busy} className={INPUT} />
          <p className="text-[12px] leading-4 text-ink-secondary">{t("usageHubs.keyHint")}</p>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => { setAdding(false); setError(""); }} disabled={busy} className="ui-button">{t("common.cancel")}</button>
            <button type="button" onClick={() => void add()} disabled={busy || !url.trim() || !key.trim()} className="ui-button">
              {busy ? t("usageHubs.adding") : t("usageHubs.add")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="ui-button mt-1">{t("usageHubs.addHub")}</button>
      )}
      {error && <div role="alert" className="mt-1 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
