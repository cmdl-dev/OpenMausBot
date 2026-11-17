import { CARD_HOLDER_MAX, CARD_NAME_MAX, CARD_POSTAL_MAX, groupCardNumber, groupExpiry, parseCard } from "@openmausbot/phone-protocol/payment-card.ts";
import { router, useLocalSearchParams } from "expo-router";
import { Check, LockKeyhole } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import type { NewVaultItem, VaultBots, VaultKind } from "@/api/client";
import { problemText } from "@/api/errors";
import { Button } from "@/components/button";
import { Chip } from "@/components/chip";
import { SectionLabel } from "@/components/list";
import { Screen } from "@/components/screen";
import { Txt } from "@/components/text";
import { LargeTitle, PageTopBar } from "@/components/top-bar";
import { useConnection } from "@/state/connection";
import { useWorld } from "@/state/world";
import { colors, radius, size, space, type } from "@/theme";

const KINDS: Array<{ kind: VaultKind; label: string }> = [
  { kind: "login", label: "Login" },
  { kind: "secret", label: "Secret" },
  { kind: "card", label: "Card" },
];
const TITLES: Record<VaultKind, string> = { login: "Add a login", secret: "Add a secret", card: "Add a card" };
const FIELD_MAX = 512;
const SECRET_MAX = 4_096;

type Fields = Record<string, string>;

/** What the person typed, as the computer takes it, or what is still missing. */
function itemOf(kind: VaultKind, fields: Fields, bots: VaultBots): { item: NewVaultItem } | { problem: string } {
  const text = (key: string) => (fields[key] ?? "").trim();
  if (kind === "login") {
    if (!text("site")) return { problem: "Enter the website, such as example.com." };
    if (!fields.password) return { problem: "Enter the password." };
    return { item: { kind, site: text("site"), username: text("username"), password: fields.password, ...(text("totp") ? { totp: text("totp") } : {}), bots } };
  }
  if (kind === "secret") {
    if (!text("name")) return { problem: "Give the secret a name. Bots ask for it by this name." };
    if (!text("value")) return { problem: "Enter the secret." };
    return { item: { kind, name: text("name"), value: fields.value ?? "", bots } };
  }
  const checked = parseCard(
    { name: text("name"), number: fields.number ?? "", expiry: fields.expiry ?? "", cvc: fields.cvc ?? "", holder: text("holder"), postalCode: text("postalCode"), bots },
    new Date(),
  );
  return checked.ok ? { item: { kind, ...checked.card } } : { problem: checked.error };
}

export default function VaultAddScreen() {
  const params = useLocalSearchParams<{ kind?: VaultKind }>();
  const world = useWorld();
  const connection = useConnection();
  const [kind, setKind] = useState<VaultKind>(KINDS.some((one) => one.kind === params.kind) ? params.kind! : "login");
  const [fields, setFields] = useState<Fields>({});
  const [bots, setBots] = useState<VaultBots>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string) => (value: string) => setFields((current) => ({ ...current, [key]: value }));
  const field = (key: string, label: string, props: TextInputProps = {}) => (
    <View style={styles.field} key={`${kind}-${key}`}>
      <Txt variant="footnote" tone="secondary" weight="500">
        {label}
      </Txt>
      <TextInput
        accessibilityLabel={label}
        value={fields[key] ?? ""}
        onChangeText={set(key)}
        placeholderTextColor={colors.text3}
        selectionColor={colors.text}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="none"
        editable={!busy}
        style={styles.input}
        {...props}
      />
    </View>
  );

  function toggleBot(id: string) {
    const current = bots === "all" ? [] : bots;
    const next = current.includes(id) ? current.filter((one) => one !== id) : [...current, id];
    setBots(next.length ? next : "all");
  }

  async function save() {
    const built = itemOf(kind, fields, bots);
    if ("problem" in built) {
      setError(built.problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await connection.addToVault(built.item);
      setFields({});
      if (router.canGoBack()) router.back();
      else router.replace("/vault");
    } catch (failure) {
      setError(problemText(failure, world.host.name));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header={<PageTopBar leading="back" />}>
      <LargeTitle>{TITLES[kind]}</LargeTitle>
      <View style={styles.kinds}>
        {KINDS.map((option) => (
          <Chip
            key={option.kind}
            label={option.label}
            selected={option.kind === kind}
            onPress={() => {
              setKind(option.kind);
              setFields({});
              setError(null);
            }}
          />
        ))}
      </View>

      <View style={styles.form}>
        {kind === "login" ? (
          <>
            {field("site", "Website", { placeholder: "example.com", keyboardType: "url", maxLength: FIELD_MAX, autoFocus: true })}
            {field("username", "Username or email", { maxLength: FIELD_MAX, keyboardType: "email-address" })}
            {field("password", "Password", { secureTextEntry: true, maxLength: FIELD_MAX, placeholder: "••••••••" })}
            {field("totp", "2FA setup key (optional)", { secureTextEntry: true, maxLength: FIELD_MAX })}
          </>
        ) : null}
        {kind === "secret" ? (
          <>
            {field("name", "Name", { placeholder: "Stripe secret key", autoCapitalize: "sentences", maxLength: 120, autoFocus: true })}
            {field("value", "Secret", { secureTextEntry: true, maxLength: SECRET_MAX, placeholder: "••••••••" })}
          </>
        ) : null}
        {kind === "card" ? (
          <>
            {field("number", "Card number", {
              placeholder: "1234 5678 9012 3456",
              keyboardType: "number-pad",
              maxLength: 23,
              autoFocus: true,
              value: fields.number ?? "",
              onChangeText: (value) => set("number")(groupCardNumber(value)),
            })}
            <View style={styles.pair}>
              <View style={styles.fill}>
                {field("expiry", "Expiry", { placeholder: "MM/YY", keyboardType: "number-pad", maxLength: 7, onChangeText: (value) => set("expiry")(groupExpiry(value)) })}
              </View>
              <View style={styles.fill}>
                {field("cvc", "Security code", {
                  placeholder: "•••",
                  keyboardType: "number-pad",
                  secureTextEntry: true,
                  maxLength: 4,
                  onChangeText: (value) => set("cvc")(value.replace(/\D/g, "")),
                })}
              </View>
            </View>
            {field("holder", "Name on card (optional)", { autoCapitalize: "words", maxLength: CARD_HOLDER_MAX })}
            {field("postalCode", "Billing ZIP or postal code (optional)", { autoCapitalize: "characters", maxLength: CARD_POSTAL_MAX })}
            {field("name", "Name (optional)", { placeholder: "Personal Visa", autoCapitalize: "sentences", maxLength: CARD_NAME_MAX })}
            <Txt variant="footnote" tone="tertiary">
              A bot pays with it only after you approve that payment in chat. The computer types the card into the checkout; the bot never sees it.
            </Txt>
          </>
        ) : null}
      </View>

      <SectionLabel>Which bots can use it</SectionLabel>
      <View style={styles.bots}>
        <BotChoice label="All bots" selected={bots === "all"} onPress={() => setBots("all")} />
        {world.bots.map((bot) => (
          <BotChoice key={bot.id} label={bot.name} selected={bots !== "all" && bots.includes(bot.id)} onPress={() => toggleBot(bot.id)} />
        ))}
      </View>

      <View style={styles.footer}>
        <View style={styles.privacy}>
          <LockKeyhole size={14} color={colors.text3} strokeWidth={size.iconStroke} />
          <Txt variant="footnote" tone="tertiary" style={styles.fill}>
            Sent once and encrypted on {world.host.name}. It's never shown again, and bots never see it.
          </Txt>
        </View>
        {error ? (
          <Txt variant="footnote" style={styles.error}>
            {error}
          </Txt>
        ) : null}
        <Button label={busy ? "Saving…" : "Save to Vault"} block disabled={busy} onPress={() => void save()} />
      </View>
    </Screen>
  );
}

function BotChoice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.botRow, pressed && styles.pressed]}
    >
      <Txt variant="callout" style={styles.fill}>
        {label}
      </Txt>
      {selected ? <Check size={size.icon} color={colors.text} strokeWidth={size.iconStroke} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  kinds: { flexDirection: "row", gap: space[2], paddingHorizontal: space[4], paddingBottom: space[3] },
  form: { paddingHorizontal: space[4], gap: space[3] },
  field: { gap: space[1] },
  pair: { flexDirection: "row", gap: space[3] },
  input: {
    ...type.callout,
    color: colors.text,
    height: 48,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  bots: { marginHorizontal: space[4], borderRadius: radius.lg, backgroundColor: colors.surface1, overflow: "hidden" },
  botRow: { flexDirection: "row", alignItems: "center", minHeight: size.tap, paddingHorizontal: space[4] },
  pressed: { backgroundColor: colors.surface2 },
  footer: { paddingHorizontal: space[4], paddingTop: space[5], gap: space[3] },
  privacy: { flexDirection: "row", gap: space[2], alignItems: "flex-start" },
  error: { color: colors.danger },
});
