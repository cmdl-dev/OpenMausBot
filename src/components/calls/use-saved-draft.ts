import { useEffect, useState } from "react";
import { keepEdits } from "./calls-settings";

/** What is saved and what the person is editing. A new `latest` (keep it stable with useMemo) replaces both, except
 * for the edits not saved yet. */
export function useSavedDraft<T extends object>(latest: T) {
  const [form, setForm] = useState({ saved: latest, draft: latest });
  useEffect(() => setForm(({ saved, draft }) => ({ saved: latest, draft: keepEdits(latest, saved, draft) })), [latest]);
  return {
    saved: form.saved,
    draft: form.draft,
    edit: (change: Partial<T>) => setForm((current) => ({ ...current, draft: { ...current.draft, ...change } })),
    markSaved: (change: Partial<T>) => setForm((current) => ({ saved: { ...current.saved, ...change }, draft: { ...current.draft, ...change } })),
  };
}
