import { useSyncExternalStore } from "react";

/** The native notifications module can't load in jest. Tests set `pushes.granted`, `pushes.token`, and tap a
 * notification with `pushes.tap(data)`. */
type Response = { notification: { request: { identifier: string; content: { data: unknown } } } };

const listeners = new Set<() => void>();
let last: Response | null = null;
let taps = 0;

export const pushes = {
  granted: false,
  asked: 0,
  token: "ab".repeat(32),
  tap(data: unknown) {
    last = { notification: { request: { identifier: `tap-${++taps}`, content: { data } } } };
    for (const listener of listeners) listener();
  },
  reset() {
    pushes.granted = false;
    pushes.asked = 0;
    last = null;
    for (const listener of listeners) listener();
  },
};

export const getPermissionsAsync = async () => ({ granted: pushes.granted, canAskAgain: !pushes.granted });
export const requestPermissionsAsync = async () => {
  pushes.asked++;
  return { granted: pushes.granted, canAskAgain: false };
};
export const getDevicePushTokenAsync = async () => ({ type: "ios", data: pushes.token });
export const setNotificationHandler = () => {};
export const getLastNotificationResponse = () => last;

export function useLastNotificationResponse(): Response | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => last,
    () => last,
  );
}
