import { useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

import type { RouterView } from "../../shared/router";
import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "./ConfirmDialog";
import { KEY_FIELD } from "./keys/KeyRow";

const INPUT = cn(KEY_FIELD, "font-sans");
const SECONDARY = "shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent";

interface Draft {
  label: string;
  url: string;
  apiKey: string;
  managementKey: string;
}

type Answer = { routers?: RouterView[]; instances?: unknown };

function useRouters() {
  const { dispatch } = useStore();
  const [routers, setRouters] = useState<RouterView[] | null>(null);
  useEffect(() => {
    let live = true;
    api("/api/routers").then((result: Answer) => { if (live && Array.isArray(result.routers)) setRouters(result.routers); }).catch(() => {});
    return () => { live = false; };
  }, []);
  /** Sends one change and takes the routers and engines it answers with. */
  const send = async (path: string, init: RequestInit) => {
    const result: Answer = await api(path, init);
    if (Array.isArray(result.routers)) setRouters(result.routers);
    if (Array.isArray(result.instances)) dispatch({ type: "instances", instances: result.instances as never });
  };
  return { routers, send };
}

function RouterForm({ router, send, onDone }: { router?: RouterView; send: (path: string, init: RequestInit) => Promise<void>; onDone: () => void }) {
  const [draft, setDraft] = useState<Draft>({ label: router?.label ?? "Router", url: router?.url ?? "", apiKey: "", managementKey: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value })),
    spellCheck: false,
    disabled: saving,
  });
  const ready = Boolean(draft.label.trim() && draft.url.trim() && (router || draft.apiKey.trim()));

  const save = async () => {
    if (saving || !ready) return;
    setSaving(true);
    setError(null);
    const body = {
      label: draft.label.trim(),
      url: draft.url.trim(),
      ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      ...(draft.managementKey.trim() ? { managementKey: draft.managementKey.trim() } : {}),
    };
    try {
      await (router
        ? send(`/api/routers/${encodeURIComponent(router.id)}`, { method: "PATCH", body: JSON.stringify(body) })
        : send("/api/routers", { method: "POST", body: JSON.stringify(body) }));
      onDone();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t("router.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form data-router-form={router?.id ?? "new"} className="flex flex-col gap-2 rounded-xl border border-hairline/50 bg-inset p-3"
      onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink">
        {t("router.name")}
        <input {...field("label")} maxLength={60} autoFocus aria-label={t("router.name")} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink">
        {t("router.address")}
        <input {...field("url")} type="url" maxLength={2048} placeholder="https://router.example.ts.net:14443" aria-label={t("router.address")} className={cn(INPUT, "font-mono")} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink">
        {t("router.apiKey")}
        <input {...field("apiKey")} type="password" maxLength={4096} autoComplete="off" aria-label={t("router.apiKey")} className={cn(INPUT, "font-mono")}
          placeholder={router ? t("router.keyKeep") : ""} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink">
        {t("router.managementKey")}
        <input {...field("managementKey")} type="password" maxLength={4096} autoComplete="off" aria-label={t("router.managementKey")} className={cn(INPUT, "font-mono")}
          placeholder={router?.usage ? t("router.keyKeep") : ""} />
      </label>
      <p className="text-[12px] leading-4 text-ink-secondary">{t("router.managementHint")}</p>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} disabled={saving} className="rounded-lg px-3 py-1.5 text-[12px] text-ink-secondary hover:bg-control disabled:opacity-50">{t("common.cancel")}</button>
        <button type="submit" disabled={saving || !ready} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-50">
          {saving && <Loader2 size={13} className="animate-spin" />}{router ? t("common.save") : t("router.connect")}
        </button>
      </div>
    </form>
  );
}

function RouterRow({ router, send, onEdit }: { router: RouterView; send: (path: string, init: RequestInit) => Promise<void>; onEdit: () => void }) {
  const { state } = useStore();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"refresh" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const engines = new Set(router.engines.map((engine) => engine.instanceId));
  const usedBy = state.bots.filter((bot) => engines.has(bot.modelSelection.instanceId)
    || bot.fallback?.some((candidate) => engines.has(candidate.instanceId))
    || bot.tasks?.some((task) => task.modelSelection && engines.has(task.modelSelection.instanceId))).length;
  const count = (engine: "claude" | "codex") => router.engines.find((candidate) => candidate.engine === engine)?.models ?? 0;
  const run = async (kind: "refresh" | "remove") => {
    setConfirming(false);
    setBusy(kind);
    setError(null);
    try {
      await send(`/api/routers/${encodeURIComponent(router.id)}${kind === "refresh" ? "/refresh" : ""}`, { method: kind === "refresh" ? "POST" : "DELETE", ...(kind === "refresh" ? { body: "{}" } : {}) });
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t("router.failed"));
    } finally {
      setBusy(null);
    }
  };
  return (
    <li data-router={router.id} className="px-3 py-2.5">
      <div className="flex min-h-9 items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ink" title={router.label}>{router.label}</div>
          <div className="truncate font-mono text-[11px] text-ink-secondary" title={router.url}>{router.url}</div>
          <div className="truncate text-[11px] text-ink-secondary">
            {[t("router.models", { claude: String(count("claude")), openai: String(count("codex")) }), router.usage ? t("router.usageOn") : t("router.usageOff")].join(" · ")}
          </div>
        </div>
        <button type="button" onClick={() => void run("refresh")} disabled={busy !== null} aria-label={t("router.refresh", { name: router.label })} title={t("router.refresh", { name: router.label })}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent">
          <RefreshCw size={14} className={busy === "refresh" ? "animate-spin" : undefined} />
        </button>
        <button type="button" onClick={onEdit} disabled={busy !== null} className={SECONDARY}>{t("router.edit")}</button>
        <button type="button" disabled={busy !== null || usedBy > 0} onClick={() => setConfirming(true)}
          title={usedBy > 0 ? t("accounts.inUse", { count: String(usedBy) }) : t("accounts.remove")}
          aria-label={t("router.remove", { name: router.label })}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent">
          {busy === "remove" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </div>
      {error && <p role="alert" className="mt-1 text-[12px] text-danger">{error}</p>}
      <ConfirmDialog open={confirming} title={t("accounts.removeTitle", { name: router.label })}
        body={t("router.removeBody")} confirmLabel={t("accounts.remove")} tone="neutral" pending={busy === "remove"}
        onCancel={() => setConfirming(false)} onConfirm={() => void run("remove")} />
    </li>
  );
}

/** Routers connected to this server: each adds a Claude and an OpenAI account that run through it. */
export function RouterSettings() {
  const { routers, send } = useRouters();
  const [open, setOpen] = useState<string | null>(null);
  if (routers === null) return null;
  return (
    <div data-routers="" className="space-y-2">
      <div className="text-[13px] leading-[18px] text-ink">{t("router.title")}</div>
      <p className="text-[12px] leading-4 text-ink-secondary">{t("router.hint")}</p>
      {routers.length > 0 && (
        <ul className="divide-y divide-hairline/40 rounded-xl border border-hairline/50 bg-panel/40">
          {routers.map((router) => open === router.id
            ? <li key={router.id} className="p-3"><RouterForm router={router} send={send} onDone={() => setOpen(null)} /></li>
            : <RouterRow key={router.id} router={router} send={send} onEdit={() => setOpen(router.id)} />)}
        </ul>
      )}
      {open === "new"
        ? <RouterForm send={send} onDone={() => setOpen(null)} />
        : <button type="button" onClick={() => setOpen("new")} className="flex min-h-8 w-fit items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-ink-secondary outline-none hover:bg-control hover:text-ink focus-visible:ring-2 focus-visible:ring-accent">
          <Plus size={14} />{t("router.add")}
        </button>}
    </div>
  );
}
