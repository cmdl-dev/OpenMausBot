import { router, useLocalSearchParams } from "expo-router";
import { Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import type { VaultKind } from "@/api/client";
import { problemText } from "@/api/errors";
import { Button } from "@/components/button";
import { SheetContent } from "@/components/sheet";
import { Txt } from "@/components/text";
import { useConnection } from "@/state/connection";
import { sectionTitle, useVault, vaultRows } from "@/state/vault";
import { useWorld } from "@/state/world";
import { colors, space } from "@/theme";

const NOUNS: Record<VaultKind, string> = { login: "login", secret: "secret", card: "card" };

/** One saved item: what it is and who may use it, never its value, and Delete. */
export default function VaultItemSheet() {
  const { kind, id } = useLocalSearchParams<{ kind: VaultKind; id: string }>();
  const world = useWorld();
  const connection = useConnection();
  const { reply, reload } = useVault();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const row = reply ? vaultRows(reply, (botId) => world.bot(botId)?.name).find((one) => one.kind === kind && one.id === id) : undefined;

  if (!row) {
    return (
      <SheetContent label="Vault item" header={null}>
        <Txt variant="subhead" tone="tertiary" style={styles.missing}>
          {reply ? "This isn't in the Vault any more." : "Loading…"}
        </Txt>
      </SheetContent>
    );
  }
  const found = row;

  function confirmDelete() {
    Alert.alert(`Delete ${found.title}?`, `Bots can't use this ${NOUNS[found.kind]} any more once it's gone from ${world.host.name}. This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setBusy(true);
          setError(null);
          void connection
            .removeFromVault(found.kind, found.id)
            .then(async () => {
              await reload();
              router.back();
            })
            .catch((failure: unknown) => setError(problemText(failure, world.host.name)))
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  return (
    <SheetContent
      label={found.title}
      header={
        <View style={styles.header}>
          <Txt variant="overline" tone="secondary">
            {sectionTitle(found.kind)}
          </Txt>
          <Txt variant="headline" numberOfLines={2}>
            {found.title}
          </Txt>
          <Txt variant="subhead" tone="secondary">
            {found.subtitle}
          </Txt>
          {found.warning ? (
            <Txt variant="subhead" style={styles.warning}>
              {found.warning}
            </Txt>
          ) : null}
        </View>
      }
    >
      <View style={styles.body}>
        <Txt variant="footnote" tone="secondary">
          {found.detail}
        </Txt>
        <Txt variant="footnote" tone="tertiary">
          {found.readOnly
            ? "This comes from a linked password manager. Change or remove it there."
            : `Encrypted on ${world.host.name}. Its value is never shown again: to change it, delete it and add it again.`}
        </Txt>
        {error ? (
          <Txt variant="footnote" style={styles.error}>
            {error}
          </Txt>
        ) : null}
        {found.readOnly ? null : <Button label={busy ? "Deleting…" : `Delete ${NOUNS[found.kind]}`} icon={Trash2} variant="danger" block disabled={busy} onPress={confirmDelete} />}
      </View>
    </SheetContent>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space[5], paddingBottom: space[3], gap: space[1] },
  body: { paddingHorizontal: space[5], gap: space[3] },
  warning: { color: colors.warning },
  error: { color: colors.danger },
  missing: { padding: space[5] },
});
