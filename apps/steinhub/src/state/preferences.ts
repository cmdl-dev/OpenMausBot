import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "dark" | "light";
export type TextSize = "small" | "default" | "large" | "xlarge";

/** Which pushes this phone asks its computer for. */
export interface NotifyChoices {
  /** A bot waits on an approval, an answer or a sign-in. */
  needsYou: boolean;
  /** A bot flagged something important with notify_person. */
  alerts: boolean;
  /** A wait the person asked for ("tell me when…") fired. */
  reminders: boolean;
  /** Every finished reply, routine reports included. */
  replies: boolean;
}

export interface Quiet {
  on: boolean;
  /** "HH:MM", 24 hours. */
  start: string;
  end: string;
}

export interface Preferences {
  theme: ThemeChoice;
  textSize: TextSize;
  /** Face ID (or the phone's passcode) opens the app. */
  lock: boolean;
  /** The bot a new chat starts with, by id; the first bot when unset or gone. */
  defaultBot: string | null;
  notify: NotifyChoices;
  quiet: Quiet;
  /** The app has asked iOS once whether it may notify. */
  pushAsked: boolean;
}

export const DEFAULTS: Preferences = {
  theme: "system",
  textSize: "default",
  lock: false,
  defaultBot: null,
  notify: { needsYou: true, alerts: true, reminders: true, replies: false },
  quiet: { on: false, start: "22:00", end: "07:00" },
  pushAsked: false,
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TEXT_SCALES: Record<TextSize, number> = { small: 0.9, default: 1, large: 1.15, xlarge: 1.3 };
export const TEXT_SIZE_LABELS: Record<TextSize, string> = { small: "Small", default: "Default", large: "Large", xlarge: "Extra large" };
export const THEME_LABELS: Record<ThemeChoice, string> = { system: "System", dark: "Dark", light: "Light" };

const KEY = "steinhub.preferences";
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

function parse(raw: string | null | undefined): Preferences {
  if (!raw) return DEFAULTS;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULTS;
    const read = value as Partial<Record<keyof Preferences, unknown>>;
    return {
      theme: read.theme === "dark" || read.theme === "light" ? read.theme : "system",
      textSize: typeof read.textSize === "string" && read.textSize in TEXT_SCALES ? (read.textSize as TextSize) : "default",
      lock: read.lock === true,
      defaultBot: typeof read.defaultBot === "string" && read.defaultBot ? read.defaultBot : null,
      notify: parseNotify(read.notify),
      quiet: parseQuiet(read.quiet),
      pushAsked: read.pushAsked === true,
    };
  } catch {
    return DEFAULTS;
  }
}

function parseNotify(raw: unknown): NotifyChoices {
  const value = raw && typeof raw === "object" ? (raw as Partial<Record<keyof NotifyChoices, unknown>>) : {};
  const flag = (key: keyof NotifyChoices) => (typeof value[key] === "boolean" ? (value[key] as boolean) : DEFAULTS.notify[key]);
  return { needsYou: flag("needsYou"), alerts: flag("alerts"), reminders: flag("reminders"), replies: flag("replies") };
}

function parseQuiet(raw: unknown): Quiet {
  const value = raw && typeof raw === "object" ? (raw as Partial<Record<keyof Quiet, unknown>>) : {};
  const clock = (key: "start" | "end") => (typeof value[key] === "string" && CLOCK.test(value[key] as string) ? (value[key] as string) : DEFAULTS.quiet[key]);
  return { on: value.on === true, start: clock("start"), end: clock("end") };
}

/** The theme and text size are read before the first screen draws, since every style is built once at start. A store
 * that can't be read yet (jest's stand-in) leaves the defaults. */
function readAtStart(): Preferences {
  try {
    return parse(SecureStore.getItem(KEY, OPTIONS));
  } catch {
    return DEFAULTS;
  }
}

let current: Preferences = readAtStart();
const listeners = new Set<() => void>();

/** What the app started with: a change to the theme or text size shows after a restart. */
export const startup: Readonly<Preferences> = current;

export function preferences(): Preferences {
  return current;
}

export async function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void> {
  current = { ...current, [key]: value };
  for (const listener of listeners) listener();
  await SecureStore.setItemAsync(KEY, JSON.stringify(current), OPTIONS);
}

/** Loads what was saved, for a store that could not be read at start. */
export async function loadPreferences(): Promise<void> {
  const saved = parse(await SecureStore.getItemAsync(KEY, OPTIONS));
  if (JSON.stringify(saved) === JSON.stringify(current)) return;
  current = saved;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, preferences, preferences);
}

/** Back to the defaults, for tests. */
export function resetPreferences(): void {
  current = DEFAULTS;
  for (const listener of listeners) listener();
}
