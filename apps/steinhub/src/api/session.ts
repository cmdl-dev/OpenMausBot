import type { PairedDevice } from "@openmausbot/phone-protocol/responses.ts";
import * as SecureStore from "expo-secure-store";

/** One paired computer. The token is the device's only credential there. */
export interface Session {
  token: string;
  /** Every address the computer can be reached on, best first. */
  urls: string[];
  serverName: string;
  device: PairedDevice;
  pairedAt: number;
}

const SESSION_KEY = "steinhub.session";
const DEMO_KEY = "steinhub.demo";

// Security: the token stays in the Keychain / Keystore, never syncs to a backup or another device.
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<Session>;
  return (
    typeof session.token === "string" &&
    Array.isArray(session.urls) &&
    session.urls.length > 0 &&
    session.urls.every((url) => typeof url === "string") &&
    typeof session.serverName === "string" &&
    typeof session.device?.id === "string" &&
    typeof session.pairedAt === "number"
  );
}

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY, OPTIONS);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), OPTIONS);
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY, OPTIONS);
}

/** null: never chosen. */
export async function loadDemoChoice(): Promise<boolean | null> {
  const raw = await SecureStore.getItemAsync(DEMO_KEY, OPTIONS);
  return raw === "on" ? true : raw === "off" ? false : null;
}

export async function saveDemoChoice(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(DEMO_KEY, on ? "on" : "off", OPTIONS);
}
