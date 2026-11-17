import { useEffect, useRef } from "react";

/** The native recognizer can't load in jest. Tests grant access with `speech.granted` and play the recognizer's
 * events with `speech.emit`. */
type Handler = (event: never) => void;

const handlers = new Map<string, Set<(event: unknown) => void>>();

export const speech = {
  granted: false,
  calls: [] as string[],
  emit(name: string, event: unknown = {}) {
    for (const handler of handlers.get(name) ?? []) handler(event);
  },
  reset() {
    speech.granted = false;
    speech.calls = [];
  },
};

export const ExpoSpeechRecognitionModule = {
  start: () => void speech.calls.push("start"),
  stop: () => void speech.calls.push("stop"),
  abort: () => void speech.calls.push("abort"),
  requestPermissionsAsync: async () => ({ granted: speech.granted }),
  supportsOnDeviceRecognition: () => false,
};

export function useSpeechRecognitionEvent(name: string, handler: Handler): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const listener = (event: unknown) => latest.current(event as never);
    const set = handlers.get(name) ?? new Set();
    set.add(listener);
    handlers.set(name, set);
    return () => void set.delete(listener);
  }, [name]);
}
