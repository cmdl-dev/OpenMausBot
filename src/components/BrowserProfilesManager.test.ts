import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot, BrowserProfile } from "@/state/store";

const fixture = vi.hoisted(() => ({ profiles: [] as BrowserProfile[], bots: [] as Bot[] }));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  ApiError: class extends Error {},
  useStore: () => ({
    state: { config: { browserProfiles: fixture.profiles, browserEngine: { kind: "engine" } }, bots: fixture.bots },
    dispatch: vi.fn(),
    flushBotPatches: vi.fn(),
  }),
}));
import { BrowserProfilesManager } from "./BrowserProfilesManager";

const bot = { id: "pepper", name: "Pepper", browserProfile: "work" } as Bot;
beforeEach(() => {
  fixture.profiles = [{ id: "work", name: "Work", partitionId: "LegacyWork" }];
  fixture.bots = [bot, { id: "scout", name: "Scout", browserProfile: "work" } as Bot];
});

afterEach(() => setLocale("en"));

describe("browser profile manager", () => {
  it("renders on the web without an Electron bridge and never exposes internal partition ids", () => {
    const html = renderToStaticMarkup(createElement(BrowserProfilesManager));
    expect(html).toContain("Create profile");
    expect(html).toContain("Work");
    expect(html).toContain("used by Pepper, Scout");
    expect(html).not.toContain("LegacyWork");
    expect(html).toMatch(/<details[^>]*\bopen/);
  });

  it("offers own, shared and temporary sessions without changing the current selection", () => {
    const html = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot }));
    expect(html).toContain('value="">Own browser</option>');
    expect(html).toContain('value="work" selected="">Work</option>');
    expect(html).toContain('value="guest"');
    expect(html).toContain("Bots on a shared profile share whatever it is signed in to; a saved login kept to some bots is filled there only if every bot on the profile may use it.");
    expect(html).not.toMatch(/<details[^>]*\bopen/);
    expect(html.match(/<select[^>]*>/)?.[0]).toContain('disabled=""');
  });

  it("explains busy bot restrictions and deletion effects in accessible controls", () => {
    fixture.bots = [{ ...bot, busy: true }];
    const html = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot }));
    expect(html).toContain("Stop this bot&#x27;s turn before switching browser profiles.");
    expect(html).toContain('aria-label="Delete Work"');
    expect(html).toContain("Pepper is still running.");
    expect(html).toContain('maxLength="40"');
  });

  it("keeps a disappeared selection explicit instead of silently displaying another login", () => {
    fixture.profiles = [];
    const html = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot }));
    expect(html).toContain("This profile was removed.");
    expect(html).toContain('value="work" disabled="" selected=""');
    expect(html).toContain("Each bot still has its own browser.");
  });

  it("offers no browser choice and no signed-in sites list for a profile: every profile is OpenMausBot's Chrome", () => {
    const html = renderToStaticMarkup(createElement(BrowserProfilesManager));
    expect(html).not.toContain("My Chrome");
    expect(html).not.toContain("Built-in");
    expect(html).not.toContain("Signed-in sites");
    fixture.bots = [{ ...bot, browserProfile: undefined }];
    expect(renderToStaticMarkup(createElement(BrowserProfilesManager, { bot: fixture.bots[0] }))).not.toContain("Signed-in sites");
  });
});
