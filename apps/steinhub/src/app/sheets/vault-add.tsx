import { router } from "expo-router";
import { CreditCard, KeyRound, LockKeyhole, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import type { VaultKind } from "@/api/client";
import { SheetContent } from "@/components/sheet";
import { Txt } from "@/components/text";
import { colors, radius, size, space } from "@/theme";

const CHOICES: Array<{ kind: VaultKind; label: string; hint: string; icon: LucideIcon }> = [
  { kind: "login", label: "Login", hint: "A website's username and password", icon: LockKeyhole },
  { kind: "secret", label: "Secret", hint: "An API key or token", icon: KeyRound },
  { kind: "card", label: "Card", hint: "A credit or debit card", icon: CreditCard },
];

export default function VaultAddSheet() {
  return (
    <SheetContent
      label="Add to Vault"
      header={
        <View style={styles.header}>
          <Txt variant="headline">Add to Vault</Txt>
        </View>
      }
    >
      <View style={styles.list}>
        {CHOICES.map(({ kind, label, hint, icon: Icon }) => (
          <Pressable
            key={kind}
            accessibilityRole="button"
            accessibilityLabel={`Add a ${label.toLowerCase()}`}
            onPress={() => router.dismissTo({ pathname: "/vault/add", params: { kind } })}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Icon size={size.icon} color={colors.text2} strokeWidth={size.iconStroke} />
            <View style={styles.fill}>
              <Txt variant="callout">{label}</Txt>
              <Txt variant="footnote" tone="secondary">
                {hint}
              </Txt>
            </View>
          </Pressable>
        ))}
      </View>
    </SheetContent>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space[5], paddingBottom: space[2] },
  fill: { flex: 1 },
  list: { paddingHorizontal: space[2] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 56, paddingHorizontal: space[3], borderRadius: radius.md },
  pressed: { backgroundColor: colors.surface1 },
});
