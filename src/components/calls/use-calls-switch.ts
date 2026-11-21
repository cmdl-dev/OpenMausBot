import { useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";

export function useCallsSwitch(key: "record" | "disclosureEnabled", saved: boolean, onSaved: () => Promise<unknown>) {
  const { dispatch } = useStore();
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const on = pending ?? saved;

  const toggle = async () => {
    const next = !on;
    setPending(next);
    setError(null);
    try {
      const config: ConfigStatus = await api("/api/config", { method: "PUT", body: JSON.stringify({ calls: { [key]: next } }) });
      dispatch({ type: "configStatus", config });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.calls.saveFailed"));
    } finally { setPending(null); }
  };

  return { on, saving: pending !== null, error, toggle };
}
