import { useEffect, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, View } from "react-native";
import { Button } from "@/components/button";
import { SteinHubMark } from "@/components/steinhub-mark";
import { Txt } from "@/components/text";
import { confirmOwner, useLockMethod } from "@/state/app-lock";
import { usePreferences } from "@/state/preferences";
import { colors, space } from "@/theme";

/** With the lock on, the app opens, and comes back from the background, behind Face ID or the phone's passcode. The
 * cover goes up as the app leaves the foreground, so the app switcher's snapshot shows it too. */
export function AppLock() {
  const { lock } = usePreferences();
  const method = useLockMethod(Platform.OS);
  const [locked, setLocked] = useState(lock);
  const asking = useRef(false);

  async function unlock() {
    if (asking.current) return;
    asking.current = true;
    const ok = await confirmOwner("Unlock SteinHub");
    asking.current = false;
    if (ok) setLocked(false);
  }

  useEffect(() => {
    if (!lock) {
      setLocked(false);
      return;
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") setLocked(true);
    });
    return () => subscription.remove();
  }, [lock]);

  useEffect(() => {
    if (!locked) return;
    if (AppState.currentState === "active") void unlock();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void unlock();
    });
    return () => subscription.remove();
  }, [locked]);

  if (!lock || !locked || method === null) return null;
  return (
    <View style={styles.cover} accessibilityViewIsModal accessibilityLabel="SteinHub is locked">
      <SteinHubMark size={64} />
      <Txt variant="headline">SteinHub is locked</Txt>
      <View style={styles.button}>
        <Button label={`Unlock with ${method ?? "Face ID"}`} onPress={() => void unlock()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFill, zIndex: 1000, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", gap: space[4] },
  button: { marginTop: space[4] },
});
