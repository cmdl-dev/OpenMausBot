import { reloadAppAsync } from "expo";

/** Restarts the JavaScript app in place: a new theme or text size takes effect on the next run's styles. */
export function restartApp(): Promise<void> {
  return reloadAppAsync("Appearance changed in Settings");
}
