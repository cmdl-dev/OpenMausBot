import { router } from "expo-router";
import { CreditCard, KeyRound, LockKeyhole, Plus, Search, type LucideIcon } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import type { VaultKind } from "@/api/client";
import { problemText } from "@/api/errors";
import { Button } from "@/components/button";
import { Chip } from "@/components/chip";
import { Group, Row, SectionLabel } from "@/components/list";
import { Screen } from "@/components/screen";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { filterRows, sectionTitle, useVault, VAULT_KINDS, vaultRows, type VaultFilter } from "@/state/vault";
import { useWorld } from "@/state/world";
import { colors, radius, size, space, type } from "@/theme";

const ICONS: Record<VaultKind, LucideIcon> = { login: LockKeyhole, secret: KeyRound, card: CreditCard };
const FILTERS: Array<{ filter: VaultFilter; label: string }> = [
  { filter: "all", label: "All" },
  { filter: "login", label: "Logins" },
  { filter: "secret", label: "Secrets" },
  { filter: "card", label: "Cards" },
];

/** The computer's Vault: what bots may use, listed by name. A saved value never comes back to the phone. */
export default function VaultScreen() {
  const world = useWorld();
  const { reply, error, loading, reload } = useVault();
  const [filter, setFilter] = useState<VaultFilter>("all");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => (reply ? vaultRows(reply, (id) => world.bot(id)?.name) : []), [reply, world]);
  const shown = filterRows(rows, filter, query);
  const add = () => router.push("/sheets/vault-add");

  return (
    <Screen header={<PageTopBar leading="back" action={{ icon: Plus, label: "Add to Vault", onPress: add }} />}>
      <LargeTitle>Vault</LargeTitle>
      <Txt variant="subhead" tone="secondary" style={styles.intro}>
        Passwords, keys and cards your bots can use. They're encrypted on {world.host.name}, and bots never see them.
      </Txt>

      {rows.length > 0 ? (
        <>
          <View style={styles.search}>
            <Search size={18} color={colors.text3} strokeWidth={size.iconStroke} />
            <TextInput
              accessibilityLabel="Search the Vault"
              placeholder="Search the Vault"
              placeholderTextColor={colors.text3}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {FILTERS.map((option) => (
              <Chip
                key={option.filter}
                label={option.label}
                count={option.filter === "all" ? undefined : rows.filter((row) => row.kind === option.filter).length}
                selected={option.filter === filter}
                onPress={() => setFilter(option.filter)}
              />
            ))}
          </ScrollView>
        </>
      ) : null}

      {error ? (
        <View style={styles.state}>
          <Txt variant="subhead" style={styles.error}>
            {problemText(error, world.host.name)}
          </Txt>
          <Button label="Try again" variant="secondary" small onPress={() => void reload()} />
        </View>
      ) : null}

      {!reply && !error ? (
        <Txt variant="subhead" tone="tertiary" style={styles.state}>
          {loading ? "Loading the Vault…" : ""}
        </Txt>
      ) : null}

      {reply && rows.length === 0 ? (
        <View style={styles.state}>
          <Txt variant="subhead" tone="tertiary">
            Nothing saved yet. Add a login, a secret or a card, or save one when a bot asks for it.
          </Txt>
          <Button label="Add to Vault" icon={Plus} small onPress={add} />
        </View>
      ) : null}

      {rows.length > 0 && shown.length === 0 ? (
        <Txt variant="subhead" tone="tertiary" style={styles.state}>
          Nothing matches your search.
        </Txt>
      ) : null}

      {VAULT_KINDS.map((kind) => {
        const section = shown.filter((row) => row.kind === kind);
        if (!section.length) return null;
        const Icon = ICONS[kind];
        return (
          <View key={kind}>
            <SectionLabel>{sectionTitle(kind)}</SectionLabel>
            <Group>
              {section.map((row) => (
                <Row
                  key={row.id}
                  title={row.title}
                  subtitle={row.warning ? `${row.subtitle} · ${row.warning}` : row.subtitle}
                  leading={<Icon size={size.icon} color={colors.text2} strokeWidth={size.iconStroke} />}
                  chevron
                  onPress={() => router.push({ pathname: "/sheets/vault-item", params: { kind, id: row.id } })}
                />
              ))}
            </Group>
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { paddingHorizontal: space[4], paddingBottom: space[3] },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    height: 44,
    marginHorizontal: space[4],
    marginBottom: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { ...type.callout, flex: 1, color: colors.text, height: 44 },
  chips: { gap: space[2], paddingHorizontal: space[4], paddingBottom: space[1] },
  state: { paddingHorizontal: space[4], paddingTop: space[6], gap: space[3], alignItems: "flex-start" },
  error: { color: colors.danger },
});
