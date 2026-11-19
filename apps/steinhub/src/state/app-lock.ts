import { useEffect, useState } from "react";

/** What the phone unlocks with, as Settings names it. */
export type LockMethod = "Face ID" | "Touch ID" | "Fingerprint" | "Face unlock" | "Passcode";

type LocalAuthentication = typeof import("expo-local-authentication");

/** A build without the native module (an older development client) has no lock to offer: null. */
async function localAuthentication(): Promise<LocalAuthentication | null> {
  try {
    return await import("expo-local-authentication");
  } catch {
    return null;
  }
}

export async function lockMethod(platform: string): Promise<LockMethod | null> {
  const auth = await localAuthentication();
  if (!auth) return null;
  try {
    const [types, enrolled] = await Promise.all([auth.supportedAuthenticationTypesAsync(), auth.isEnrolledAsync()]);
    if (!enrolled) return "Passcode";
    if (types.includes(auth.AuthenticationType.FACIAL_RECOGNITION)) return platform === "ios" ? "Face ID" : "Face unlock";
    if (types.includes(auth.AuthenticationType.FINGERPRINT)) return platform === "ios" ? "Touch ID" : "Fingerprint";
    return "Passcode";
  } catch {
    return null;
  }
}

/** Undefined while it is being looked up; null when this build can't lock. */
export function useLockMethod(platform: string): LockMethod | null | undefined {
  const [method, setMethod] = useState<LockMethod | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void lockMethod(platform).then((found) => {
      if (live) setMethod(found);
    });
    return () => {
      live = false;
    };
  }, [platform]);
  return method;
}

/** Face ID, Touch ID or the phone's passcode; false when the person cancels or the phone can't ask. */
export async function confirmOwner(reason: string): Promise<boolean> {
  const auth = await localAuthentication();
  if (!auth) return false;
  try {
    return (await auth.authenticateAsync({ promptMessage: reason, cancelLabel: "Cancel", disableDeviceFallback: false })).success;
  } catch {
    return false;
  }
}
