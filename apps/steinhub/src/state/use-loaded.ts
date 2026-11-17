import { useEffect, useRef, useState } from "react";
import { problemText } from "@/api/errors";

export type Loaded<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; problem: string };

/** One read from the computer for a screen: loading, its answer, or the sentence a failure shows. Reads again when `key` changes. */
export function useLoaded<T>(read: () => Promise<T>, key: string, computer: string): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    let current = true;
    setLoaded({ state: "loading" });
    latest.current().then(
      (value) => {
        if (current) setLoaded({ state: "ready", value });
      },
      (failure: unknown) => {
        if (current) setLoaded({ state: "failed", problem: problemText(failure, computer) });
      },
    );
    return () => {
      current = false;
    };
  }, [key, computer]);
  return loaded;
}
