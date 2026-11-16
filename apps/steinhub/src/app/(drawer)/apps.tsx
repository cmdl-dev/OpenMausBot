import { Blocks, Check, Plus, Search } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Linking, StyleSheet, TextInput, View } from "react-native";
import { SvgUri } from "react-native-svg";
import type { AppCard, AppConnection } from "@/api/client";
import { problemText } from "@/api/errors";
import { Button } from "@/components/button";
import { SectionLabel } from "@/components/list";
import { Screen } from "@/components/screen";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { useConnection } from "@/state/connection";
import { useWorld } from "@/state/world";
import { colors, radius, size, space, type } from "@/theme";

/** How long a started sign-in is watched for before the row gives up waiting. */
const SIGN_IN_WAIT_MS = 3 * 60_000;
const SIGN_IN_POLL_MS = 3_000;
/** The full catalog runs to well over a thousand apps; a search narrows it. */
const SHOWN_WITHOUT_SEARCH = 60;

type Row = { kind: "label"; key: string; text: string } | { kind: "app"; key: string; card: AppCard; connection: AppConnection | undefined };

export default function AppsScreen() {
  const connection = useConnection();
  const world = useWorld();
  const [cards, setCards] = useState<AppCard[] | null>(null);
  const [connections, setConnections] = useState<Record<string, AppConnection>>({});
  const [configured, setConfigured] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [waiting, setWaiting] = useState<Record<string, true>>({});
  const [naming, setNaming] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ slug: string; text: string } | null>(null);
  const watches = useRef(new Map<string, () => void>());
  const { apps, appStatus, connectApp } = connection;

  const load = useCallback(() => {
    setFailure(null);
    apps()
      .then(({ catalog, connected }) => {
        setCards(catalog.cards);
        setConnections(connected.services);
        setConfigured(catalog.configured && connected.configured);
      })
      .catch(setFailure);
  }, [apps]);

  useEffect(load, [load]);
  useEffect(() => {
    const open = watches.current;
    return () => open.forEach((stop) => stop());
  }, []);

  const watch = useCallback(
    (slug: string, accountsBefore: number) => {
      watches.current.get(slug)?.();
      const started = Date.now();
      const timer = setInterval(() => {
        appStatus(slug)
          .then((status) => {
            if (!status) return;
            const added = (status.accounts?.length ?? 0) > accountsBefore || (accountsBefore === 0 && status.connected);
            if (!added && Date.now() - started < SIGN_IN_WAIT_MS) return;
            stop();
            if (added) setConnections((current) => ({ ...current, [slug]: status }));
          })
          .catch(() => undefined);
      }, SIGN_IN_POLL_MS);
      const stop = () => {
        clearInterval(timer);
        watches.current.delete(slug);
        setWaiting(({ [slug]: _done, ...rest }) => rest);
      };
      watches.current.set(slug, stop);
      setWaiting((current) => ({ ...current, [slug]: true }));
    },
    [appStatus],
  );

  const connect = useCallback(
    async (card: AppCard, alias?: string) => {
      setRowError(null);
      try {
        const url = await connectApp(card.slug, alias);
        setNaming(null);
        watch(card.slug, connections[card.slug]?.accounts?.length ?? 0);
        await Linking.openURL(url);
      } catch (error) {
        setRowError({ slug: card.slug, text: problemText(error, world.host.name) });
      }
    },
    [connectApp, connections, watch, world.host.name],
  );

  const rows = useMemo((): Row[] => {
    if (!cards) return [];
    const needle = query.trim().toLowerCase();
    const matches = (card: AppCard) => !needle || card.label.toLowerCase().includes(needle) || card.slug.includes(needle) || card.categories?.some((name) => name.toLowerCase().includes(needle));
    const connected = cards.filter((card) => connections[card.slug]?.connected && matches(card));
    const others = cards.filter((card) => !connections[card.slug]?.connected && matches(card));
    const shown = needle ? others : others.slice(0, SHOWN_WITHOUT_SEARCH);
    return [
      ...(connected.length ? [{ kind: "label" as const, key: "label:connected", text: "Connected" }] : []),
      ...connected.map((card) => ({ kind: "app" as const, key: card.slug, card, connection: connections[card.slug] })),
      ...(shown.length ? [{ kind: "label" as const, key: "label:add", text: needle ? "Results" : "Add an app" }] : []),
      ...shown.map((card) => ({ kind: "app" as const, key: card.slug, card, connection: connections[card.slug] })),
    ];
  }, [cards, connections, query]);

  const hidden = cards && !query.trim() ? cards.filter((card) => !connections[card.slug]?.connected).length - SHOWN_WITHOUT_SEARCH : 0;

  return (
    <Screen scroll={false} header={<PageTopBar leading="menu" />}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <LargeTitle>Apps</LargeTitle>
            <View style={styles.search}>
              <Search size={18} color={colors.text3} strokeWidth={size.iconStroke} />
              <TextInput
                accessibilityLabel="Search apps"
                placeholder="Search apps"
                placeholderTextColor={colors.text3}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.searchInput}
              />
            </View>
            {!configured ? (
              <Txt variant="footnote" tone="secondary" style={styles.note}>
                Connected apps aren't set up on {world.host.name} yet. Set them up in the desktop app's Apps page.
              </Txt>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          failure ? (
            <View style={styles.empty}>
              <Txt variant="footnote" style={styles.errorText}>
                {problemText(failure, world.host.name)}
              </Txt>
              <Button label="Try again" variant="secondary" small onPress={load} />
            </View>
          ) : cards === null ? (
            <ActivityIndicator color={colors.text3} style={styles.empty} />
          ) : (
            <Txt variant="subhead" tone="tertiary" style={styles.empty}>
              No app matches “{query.trim()}”.
            </Txt>
          )
        }
        ListFooterComponent={
          hidden > 0 ? (
            <Txt variant="footnote" tone="tertiary" style={styles.note}>
              {`${hidden.toLocaleString()} more apps: search to find one.`}
            </Txt>
          ) : undefined
        }
        renderItem={({ item }) =>
          item.kind === "label" ? (
            <SectionLabel>{item.text}</SectionLabel>
          ) : (
            <AppRow
              card={item.card}
              connection={item.connection}
              waiting={Boolean(waiting[item.card.slug])}
              naming={naming === item.card.slug}
              error={rowError?.slug === item.card.slug ? rowError.text : null}
              onConnect={(alias) => void connect(item.card, alias)}
              onName={() => setNaming(item.card.slug)}
            />
          )
        }
      />
    </Screen>
  );
}

function AppRow({
  card,
  connection,
  waiting,
  naming,
  error,
  onConnect,
  onName,
}: {
  card: AppCard;
  connection: AppConnection | undefined;
  waiting: boolean;
  naming: boolean;
  error: string | null;
  onConnect: (alias?: string) => void;
  onName: () => void;
}) {
  const [alias, setAlias] = useState("");
  const connected = Boolean(connection?.connected);
  const accounts = connection?.accounts?.map((account) => account.alias?.trim()).filter((name): name is string => Boolean(name)) ?? [];
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={styles.logo}>
          <AppLogo uri={card.logo} />
        </View>
        <View style={styles.fill}>
          <Txt variant="callout" weight="600" numberOfLines={1}>
            {card.label}
          </Txt>
          <Txt variant="footnote" tone="secondary" numberOfLines={connected ? 1 : 2}>
            {connected ? (accounts.length ? accounts.join(" · ") : "Connected") : card.blurb}
          </Txt>
        </View>
        {waiting ? (
          <View style={styles.waiting}>
            <ActivityIndicator size="small" color={colors.text3} />
          </View>
        ) : connected ? (
          card.noAuth ? (
            <Check size={size.icon} color={colors.success} strokeWidth={size.iconStroke} />
          ) : (
            <Button label="Add account" icon={Plus} variant="secondary" small onPress={onName} />
          )
        ) : (
          <Button label="Connect" variant="secondary" small onPress={() => onConnect()} />
        )}
      </View>
      {waiting ? (
        <Txt variant="footnote" tone="tertiary">
          Finish signing in on the page that opened, then come back.
        </Txt>
      ) : null}
      {naming && !waiting ? (
        <View style={styles.aliasRow}>
          <TextInput
            accessibilityLabel={`Name for the new ${card.label} account`}
            placeholder="Name it, like Work or Personal"
            placeholderTextColor={colors.text3}
            value={alias}
            onChangeText={setAlias}
            autoFocus
            style={[styles.aliasInput, styles.fill]}
          />
          <Button label="Connect" small disabled={!alias.trim()} onPress={() => onConnect(alias.trim())} />
        </View>
      ) : null}
      {error ? (
        <Txt variant="footnote" style={styles.errorText}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

/** Composio serves its logos as SVG, which React Native's Image cannot draw. */
function AppLogo({ uri }: { uri: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!uri || failed) return <Blocks size={18} color={colors.text2} strokeWidth={size.iconStroke} />;
  return <SvgUri uri={uri} width={LOGO} height={LOGO} onError={() => setFailed(true)} />;
}

const LOGO = 24;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { paddingBottom: space[8] },
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
  searchInput: { ...type.callout, flex: 1, color: colors.text, paddingVertical: 0 },
  note: { paddingHorizontal: space[5], paddingVertical: space[3] },
  empty: { alignItems: "center", gap: space[2], marginTop: space[8], paddingHorizontal: space[5], textAlign: "center" },
  errorText: { color: colors.danger },
  row: { gap: space[2], paddingHorizontal: space[4], paddingVertical: space[3] },
  rowTop: { flexDirection: "row", alignItems: "center", gap: space[3] },
  logo: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  waiting: { width: 44, alignItems: "center" },
  aliasRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  aliasInput: {
    ...type.callout,
    color: colors.text,
    height: 40,
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
});
