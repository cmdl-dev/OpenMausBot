import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { browserAvailable, type FeatureFlagConfig } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { visibilityState: "visible" });
  const view = { current: "browser" };
  vi.stubGlobal("localStorage", { getItem: () => view.current });
  return { config: {} as FeatureFlagConfig & { cloudHome?: boolean }, view };
});
// These cover the Advanced panel; ComputerPanel.simple.test.ts covers Simple.
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({
    state: { config: { box: { configured: false }, ...fixture.config }, instances: [], computerControl: {}, routines: [], routineRuns: [] },
    dispatch: vi.fn(),
    flushBotPatches: vi.fn(),
  }),
}));
import { ComputerPanel } from "./ComputerPanel";

afterAll(() => vi.unstubAllGlobals());
const bot = { id: "browser-fixture", name: "Browser fixture", modelSelection: { instanceId: "fixture" } } as Bot;
const render = (config: FeatureFlagConfig & { cloudHome?: boolean }, browser?: boolean) => {
  fixture.config = config;
  return renderToStaticMarkup(createElement(ComputerPanel, { bot: { ...bot, browser } }));
};

describe("Browser panel without Chrome", () => {
  const missing = { kind: "unavailable", reason: "Google Chrome is not installed.", installChrome: true } as const;

  it("says installing Google Chrome gives the bots a browser, and offers no install of its own", () => {
    const config = { features: { browser: true }, browserEngine: missing };
    const markup = render(config);
    expect(markup).toContain("Install Google Chrome, then restart");
    expect(markup).not.toContain("Install the browser");
    expect(browserAvailable(config)).toBe(false);
  });

  it("retains the global and per-bot opt-in gates", () => {
    expect(render({ browserEngine: missing })).not.toContain(t("browser.panel.unavailable"));
    expect(render({ features: { browser: true }, browserEngine: missing }, false)).not.toContain(t("browser.panel.unavailable"));
  });

  it("shows a ready engine", () => {
    const ready = render({ features: { browser: true }, browserEngine: { kind: "engine" } });
    expect(ready).toContain("Opening the live browser…");
    expect(ready).not.toMatch(/Loading browser…|Only admins/);
  });
});

describe("Computer panel on a narrow screen", () => {
  it("covers the window below md instead of docking a 400px column", () => {
    const markup = render({});
    const aside = /<aside class="([^"]*)"/.exec(markup)!;
    expect(aside[1].split(" ")).toEqual(expect.arrayContaining(["max-md:absolute", "max-md:inset-0", "max-md:z-40", "max-md:w-full!"]));
    const separator = /<div role="separator"[^>]*class="([^"]*)"/.exec(markup)!;
    expect(separator[1].split(" ")).toContain("max-md:hidden");
  });
});

describe("Computer panel Works on", () => {
  const places = (markup: string) => [...markup.matchAll(/<span>(Auto|Cloud desktop|Private desktop|This computer|Browser|Off)<\/span>/g)].map((match) => match[1]);
  const computerTab = (config: FeatureFlagConfig & { cloudHome?: boolean }) => {
    fixture.view.current = "computer";
    try { return render(config); } finally { fixture.view.current = "browser"; }
  };

  it("lists this computer and a private desktop on a desktop or self-hosted server", () => {
    const markup = computerTab({});
    expect(places(markup)).toEqual(["Auto", "Cloud desktop", "Private desktop", "This computer", "Browser", "Off"]);
    expect(markup).toContain("Choose where this bot works.</p>");
  });

  it("lists neither on My Cloud, and says why", () => {
    const markup = computerTab({ cloudHome: true });
    expect(places(markup)).toEqual(["Auto", "Cloud desktop", "Browser", "Off"]);
    expect(markup).toContain("Choose where this bot works. It can also use your computer whenever MausBot is open on it.");
  });
});

describe("Computer panel header", () => {
  it("names its icon-only close button", () => {
    expect(render({})).toContain(`aria-label="${t("computer.close")}"`);
  });
});
