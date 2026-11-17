import type { PhonePushState, PushKind, PushQuietHours } from "@openmausbot/phone-protocol/phone-push.ts";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { useConnection } from "@/state/connection";
import { setPreference, usePreferences, type NotifyChoices, type Quiet } from "@/state/preferences";

const PAIRING = /^[A-Za-z0-9_-]{8,64}$/;

export type Permission = "granted" | "denied" | "undetermined" | "unsupported";

/** The kinds the phone asks its computer to push, from the person's switches. */
export function pushKinds(notify: NotifyChoices): PushKind[] {
  return [
    ...(notify.needsYou ? (["approval", "question", "sign-in"] as const) : []),
    ...(notify.alerts ? (["alert"] as const) : []),
    ...(notify.reminders ? (["wait"] as const) : []),
    ...(notify.replies ? (["done"] as const) : []),
  ];
}

export function quietHours(quiet: Quiet, timeZone = localTimeZone()): PushQuietHours | undefined {
  return quiet.on ? { start: quiet.start, end: quiet.end, timeZone } : undefined;
}

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Where a tapped push should open: its conversation, at its message when it names one. A push carries its fields under
 * `omb` and `body`; expo-notifications (SDK 58) hands the app either the `body` object itself or the whole payload. */
export function pushTarget(data: unknown): { threadId: string; messageId?: string } | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const nested = record.omb ?? record.body;
  const raw = typeof nested === "string" ? safeJson(nested) : nested && typeof nested === "object" ? nested : record;
  if (!raw || typeof raw !== "object") return null;
  const fields = raw as Record<string, unknown>;
  const threadId = typeof fields.threadId === "string" && /^[\w-]{1,128}$/.test(fields.threadId) ? fields.threadId : null;
  if (!threadId) return null;
  const messageId = typeof fields.messageId === "string" && /^[\w-]{1,128}$/.test(fields.messageId) ? fields.messageId : undefined;
  return { threadId, ...(messageId ? { messageId } : {}) };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** iOS only for now: Android needs Firebase Cloud Messaging, which this build doesn't carry. */
const SUPPORTED = Platform.OS === "ios";

export async function permission(): Promise<Permission> {
  if (!SUPPORTED) return "unsupported";
  try {
    const status = await Notifications.getPermissionsAsync();
    return status.granted ? "granted" : status.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "unsupported";
  }
}

export async function askPermission(): Promise<Permission> {
  if (!SUPPORTED) return "unsupported";
  try {
    const status = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } });
    return status.granted ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

let handledResponse: string | null = null;

/** A push the person tapped to open the app, not yet acted on: the launch screen leaves the app where it opens. */
export function launchedFromPush(): boolean {
  try {
    const response = Notifications.getLastNotificationResponse();
    return Boolean(response && response.notification.request.identifier !== handledResponse && pushTarget(response.notification.request.content.data));
  } catch {
    return false;
  }
}

export interface PushState {
  permission: Permission;
  /** What the computer says of pushes: "on", "off" (switched off there), "no-account"; null before it answers. */
  server: PhonePushState | null;
  problem: string | null;
  enable: () => Promise<void>;
}

const PushContext = createContext<PushState | null>(null);

export function usePushState(): PushState {
  const state = useContext(PushContext);
  if (!state) throw new Error("usePushState outside PushProvider");
  return state;
}

/** Keeps this phone's push registration on its computer in step with its switches, and opens what a tapped push
 * points at. One per app. */
export function PushProvider({ children }: { children: ReactNode }) {
  const value = usePush();
  return createElement(PushContext.Provider, { value }, children);
}

function usePush(): PushState {
  const connection = useConnection();
  const prefs = usePreferences();
  const [state, setState] = useState<Permission>("undetermined");
  const [server, setServer] = useState<PhonePushState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const live = connection.mode === "live";
  const kinds = pushKinds(prefs.notify).join(",");
  const quiet = JSON.stringify(quietHours(prefs.quiet) ?? null);
  const registerPush = connection.registerPush;
  const sessionDevice = connection.session?.device.id;
  const lastResponse = Notifications.useLastNotificationResponse();
  const asked = useRef(false);

  useEffect(() => {
    void permission().then(setState);
  }, []);

  useEffect(() => {
    if (!live || state !== "undetermined" || asked.current || prefs.pushAsked) return;
    asked.current = true;
    void setPreference("pushAsked", true);
    void askPermission().then(setState);
  }, [live, state, prefs.pushAsked]);

  useEffect(() => {
    if (!live || state !== "granted") return;
    let current = true;
    (async () => {
      const token = (await Notifications.getDevicePushTokenAsync()).data;
      if (typeof token !== "string") return;
      const answer = await registerPush({
        platform: "apns",
        token: token.toLowerCase(),
        environment: apnsEnvironment(),
        kinds: kinds ? (kinds.split(",") as PushKind[]) : [],
        ...(bundleId() ? { bundle: bundleId() } : {}),
        ...(sessionDevice && PAIRING.test(sessionDevice) ? { pairing: sessionDevice } : {}),
        ...(JSON.parse(quiet) ? { quiet: JSON.parse(quiet) as PushQuietHours } : {}),
      });
      if (!current) return;
      setServer(answer.push);
      setProblem(null);
    })().catch((failure: unknown) => {
      if (current) setProblem(failure instanceof Error ? failure.message : "Couldn't turn on notifications with the computer.");
    });
    return () => {
      current = false;
    };
  }, [live, state, kinds, quiet, registerPush, sessionDevice]);

  useEffect(() => {
    if (!lastResponse) return;
    const id = lastResponse.notification.request.identifier;
    if (id === handledResponse) return;
    const target = pushTarget(lastResponse.notification.request.content.data);
    if (!target) return;
    handledResponse = id;
    router.push({ pathname: "/chat/[id]", params: { id: target.threadId, ...(target.messageId ? { message: target.messageId } : {}) } });
  }, [lastResponse]);

  async function enable() {
    setState(await askPermission());
  }

  return { permission: state, server, problem, enable };
}

function bundleId(): string | undefined {
  return Constants.expoConfig?.ios?.bundleIdentifier;
}

/** A development-signed build (every SteinHub build so far) is reachable only through Apple's sandbox. */
function apnsEnvironment(): "sandbox" | "production" {
  return Constants.expoConfig?.extra?.apnsEnvironment === "production" ? "production" : "sandbox";
}
