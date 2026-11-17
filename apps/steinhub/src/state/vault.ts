import { BRAND_NAMES, cardExpired, expiryLabel } from "@openmausbot/phone-protocol/payment-card.ts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import type { VaultBots, VaultKind, VaultReply } from "@/api/client";
import { useConnection } from "@/state/connection";
import { shortWhen } from "@/state/views";

export type VaultFilter = "all" | VaultKind;

export interface VaultRow {
  kind: VaultKind;
  id: string;
  title: string;
  subtitle: string;
  /** Who may use it, and when it was last used. */
  detail: string;
  /** Kept in a linked password manager: changed there, never here. */
  readOnly: boolean;
  warning?: string;
}

const SECTION_TITLES: Record<VaultKind, string> = { login: "Logins", secret: "Keys & secrets", card: "Cards" };
export const VAULT_KINDS: readonly VaultKind[] = ["login", "secret", "card"];

export function sectionTitle(kind: VaultKind): string {
  return SECTION_TITLES[kind];
}

export function whoMayUse(bots: VaultBots, names: (id: string) => string | undefined): string {
  if (bots === "all") return "All bots";
  const known = bots.flatMap((id) => names(id) ?? []);
  return known.length ? known.join(", ") : "No bots";
}

function used(at: number | undefined, now: number): string {
  return at ? `Used ${shortWhen(at, now)}` : "Not used yet";
}

/** Every saved item as a row, sorted by name within its kind. */
export function vaultRows(reply: VaultReply, names: (id: string) => string | undefined, now = Date.now()): VaultRow[] {
  const detail = (bots: VaultBots, at: number | undefined) => `${whoMayUse(bots, names)} · ${used(at, now)}`;
  const today = new Date(now);
  const rows: VaultRow[] = [
    ...reply.logins.map((login) => ({
      kind: "login" as const,
      id: login.id,
      title: login.site,
      subtitle: [login.username || "No username", login.hasTotp ? "2FA" : null].filter(Boolean).join(" · "),
      detail: detail(login.bots, login.lastUsedAt),
      readOnly: login.source === "1password",
    })),
    ...reply.secrets.map((secret) => ({
      kind: "secret" as const,
      id: secret.id,
      title: secret.name,
      subtitle: secret.source === "linked" ? `From ${secret.provider === "1password" ? "1Password" : (secret.provider ?? "a password manager")}` : secret.source === "card" ? "Saved from a bot's request" : "Added in Settings",
      detail: detail(secret.bots, secret.lastUsedAt),
      readOnly: secret.source === "linked",
    })),
    ...(reply.cards ?? []).map((card) => ({
      kind: "card" as const,
      id: card.id,
      title: card.name,
      subtitle: `${BRAND_NAMES[card.brand]} ending ${card.last4} · Expires ${expiryLabel(card.expMonth, card.expYear)}`,
      detail: detail(card.bots, card.lastUsedAt),
      readOnly: false,
      ...(cardExpired(card.expMonth, card.expYear, today) ? { warning: "Expired" } : {}),
    })),
  ];
  return rows.sort((a, b) => VAULT_KINDS.indexOf(a.kind) - VAULT_KINDS.indexOf(b.kind) || a.title.localeCompare(b.title));
}

export function filterRows(rows: readonly VaultRow[], filter: VaultFilter, query: string): VaultRow[] {
  const words = query.trim().toLowerCase();
  return rows.filter((row) => (filter === "all" || row.kind === filter) && (!words || `${row.title} ${row.subtitle}`.toLowerCase().includes(words)));
}

let latest: { mode: string; reply: VaultReply } | null = null;

/** The Vault as last read, read again whenever a screen showing it comes into view. */
export function useVault() {
  const connection = useConnection();
  const [reply, setReply] = useState<VaultReply | null>(latest?.mode === connection.mode ? latest.reply : null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await connection.vault();
      latest = { mode: connection.mode, reply: next };
      setReply(next);
      setError(null);
    } catch (failure) {
      setError(failure);
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { reply, error, loading, reload };
}
