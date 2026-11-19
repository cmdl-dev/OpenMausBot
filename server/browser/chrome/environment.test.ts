import { describe, expect, it } from "vitest";

import { browserLanguage, browserTimeZone, languageList, shellQuote } from "./environment.ts";

describe("the language and time zone the bots' Chrome is given", () => {
  it("uses the app or system language and falls back to English for a C locale", () => {
    expect(browserLanguage({ OMB_BROWSER_LANG: "de-DE", LANG: "en_US.UTF-8" })).toBe("de-DE");
    expect(browserLanguage({}, "ko-KR")).toBe("ko-KR");
    expect(browserLanguage({}, "ko")).toBe("ko-KR");
    expect(browserLanguage({ LANG: "fr_FR.UTF-8" }, "ko-KR")).toBe("ko-KR");
    expect(browserLanguage({ OMB_BROWSER_LANG: "ja-JP" }, "ko-KR")).toBe("ja-JP");
    expect(browserLanguage({ LANG: "fr_FR.UTF-8" }, "not a locale")).toBe("fr-FR");
    expect(browserLanguage({ LANG: "en_GB.UTF-8" })).toBe("en-GB");
    expect(browserLanguage({ LC_ALL: "fr_FR@euro", LANG: "en_US.UTF-8" })).toBe("fr-FR");
    expect(browserLanguage({ LANG: "C.UTF-8" })).toBe("en-US");
    expect(browserLanguage({ LANG: "POSIX" })).toBe("en-US");
    expect(browserLanguage({})).toBeUndefined();
    expect(browserLanguage({ OMB_BROWSER_LANG: "en US; rm" })).toBeUndefined();
    expect(browserLanguage({ OMB_BROWSER_LANG: "en US; rm" }, "ko")).toBe("ko-KR");
  });

  it("gives Chrome the server's time zone, where Chrome reads TZ", () => {
    expect(browserTimeZone({ TZ: "Asia/Kolkata" }, "linux")).toBe("Asia/Kolkata");
    expect(browserTimeZone({ OMB_BROWSER_TIMEZONE: "Europe/Berlin", TZ: "UTC" }, "linux")).toBe("Europe/Berlin");
    expect(browserTimeZone({ TZ: "Asia/Kolkata" }, "win32")).toBeUndefined();
    expect(browserTimeZone({}, "darwin")).toBeUndefined();
    expect(browserTimeZone({ TZ: "Asia/Kolkata'; reboot" }, "linux")).toBeUndefined();
  });
});

describe("the languages pages are told", () => {
  it("lists the person's language, its base and English after, never with q-values", () => {
    expect(languageList("pt-BR")).toBe("pt-BR,pt,en-US,en");
    expect(languageList("en-US")).toBe("en-US,en");
    expect(languageList("en-IN")).toBe("en-IN,en");
    expect(languageList("de")).toBe("de,en-US,en");
    expect(languageList(undefined)).toBe("en-US,en");
  });
});

describe("shell quoting", () => {
  it("keeps a value whole, quotes and all", () => {
    expect(shellQuote("it's $HOME")).toBe("'it'\\''s $HOME'");
  });
});
