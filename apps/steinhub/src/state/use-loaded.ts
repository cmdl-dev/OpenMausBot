import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { problemText } from "@/api/errors";

export type Loaded<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; problem: string };

/** A screen's read from the computer: loading, its answer, or the sentence a failure shows. It reads again when `key`
 * changes and each time the screen comes back into view, keeping what it showed until the new answer arrives, and
 * `reload` reads again on request (pull to refresh). */
export function useLoaded<T>(read: () => Promise<T>, key: string, computer: string): Loaded<T> & { reloading: boolean; reload: () => void } {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const [reloading, setReloading] = useState(false);
  const latest = useRef(read);
  latest.current = read;
  const generation = useRef(0);

  const fetchNow = useCallback(
    (showSpinner: boolean) => {
      const mine = ++generation.current;
      if (showSpinner) setReloading(true);
      latest.current().then(
        (value) => {
          if (mine === generation.current) setLoaded({ state: "ready", value });
        },
        (failure: unknown) => {
          if (mine === generation.current) setLoaded({ state: "failed", problem: problemText(failure, computer) });
        },
      ).finally(() => {
        if (mine === generation.current) setReloading(false);
      });
    },
    [computer],
  );

  useEffect(() => {
    setLoaded({ state: "loading" });
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      fetchNow(false);
    }, [fetchNow, key]),
  );

  const reload = useCallback(() => fetchNow(true), [fetchNow]);
  return { ...loaded, reloading, reload };
}
