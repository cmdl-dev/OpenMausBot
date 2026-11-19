// The language, languages and time zone the bots' Chrome is given, and quoting for the shell scripts OMB writes.

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Explicit OMB_BROWSER_LANG, app language, then the POSIX locale; "C" and "POSIX" name no language. */
export function browserLanguage(env: NodeJS.ProcessEnv, configured?: string): string | undefined {
  const named = env.OMB_BROWSER_LANG?.trim();
  if (named && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(named)) return named;
  const app = configured?.trim();
  if (app && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(app)) {
    try {
      const canonical = Intl.getCanonicalLocales(app)[0];
      return canonical?.toLowerCase() === "ko" ? "ko-KR" : canonical;
    } catch {}
  }
  const locale = env.LC_ALL?.trim() || env.LC_MESSAGES?.trim() || env.LANG?.trim() || "";
  if (/^(?:C|POSIX)(?:[.@].*)?$/u.test(locale)) return "en-US";
  const match = /^([a-z]{2,3})(?:_([A-Z]{2}))?(?:[.@]|$)/u.exec(locale);
  return match ? (match[2] ? `${match[1]}-${match[2]}` : match[1]) : undefined;
}

/** The languages pages are told, best first, for the person's language: "pt-BR" gives "pt-BR,pt,en-US,en", none "en-US,en".
 * As a list, never with q-values: Chrome adds those to the Accept-Language header itself, and navigator.languages would
 * otherwise list "en;q=0.9" as a language. A headless Chrome on Linux tells pages only its first language (Chrome 155),
 * so the bots' browsers are given the whole list. */
export function languageList(language: string | undefined): string {
  const first = language ?? "en-US";
  const base = first.split("-")[0]!;
  return [first, ...(base !== first ? [base] : []), ...(base === "en" ? [] : ["en-US", "en"])].join(",");
}

/** The zone the server runs in, which is also the one each turn's clock shows; Windows Chrome ignores TZ. */
export function browserTimeZone(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  const zone = env.OMB_BROWSER_TIMEZONE?.trim() || (platform === "win32" ? "" : env.TZ?.trim() || "");
  return /^:?[A-Za-z0-9_+\-./]{1,64}$/u.test(zone) ? zone : undefined;
}
