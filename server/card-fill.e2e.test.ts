// fill_card on real Chrome: a provider's card fields in cross-site frames, a plain form with month and year lists, and
// the guard that keeps a typed card out of screenshots.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CdpPage } from "./browser/cdp/page.ts";
import { FixtureServer } from "./browser/cdp/testing/fixtures.ts";
import { CHROME, startChrome, type RunningChrome } from "./browser/cdp/testing/real-chrome.ts";
import { fillCard, pageShowsAmount, type CardFillDeps } from "./card-fill.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

// Obvious fakes only: Stripe's published test card.
const CARD = { number: "4242424242424242", expMonth: 4, expYear: 2031, cvc: "314", holder: "Ada Lovelace", postalCode: "94107" };

const suite = CHROME ? describe : describe.skip;

suite("fill_card on real Chrome", () => {
  let fx: FixtureServer;
  let run: RunningChrome;
  let page: CdpPage;
  let pages = 0;

  beforeAll(async () => {
    fx = await FixtureServer.start();
    run = await startChrome("card-fill");
    page = await run.browser.waitForPage();
  }, hostTimeout(180_000));

  afterAll(async () => {
    await run?.close();
    await fx?.close();
  });

  async function open(html: string, on: CdpPage = page): Promise<void> {
    const url = fx.page(`/checkout${++pages}`, `<!doctype html><meta charset="utf-8"><title>Checkout</title>${html}`);
    await on.navigate(url);
    await on.waitFor({ ms: 400 });
  }

  function deps(on: CdpPage, remembered: string[] = []): CardFillDeps {
    return {
      frames: () => on.frames.all().map((frame) => ({ id: frame.id, url: frame.url, main: frame.id === on.frames.mainFrameId })),
      read: (frameId, script) => on.evaluateInFrame(frameId, script, { whileSecret: true }),
      type: (frameId, selector, value) => on.fillSecretInFrame(frameId, selector, value),
      remember: (value) => { remembered.push(value); },
    };
  }

  const valueIn = async (on: CdpPage, frameId: string, selector: string) =>
    on.evaluateInFrame(frameId, `document.querySelector(${JSON.stringify(selector)}).value`, { whileSecret: true });

  it("types the card into a provider's cross-site frames, and screenshots stay refused while it is there", async () => {
    fx.page("/elements/number", `<!doctype html><input name="cardnumber" autocomplete="cc-number" placeholder="Card number" inputmode="numeric">`);
    fx.page("/elements/expiry", `<!doctype html><input name="exp-date" autocomplete="cc-exp" placeholder="MM / YY">`);
    fx.page("/elements/cvc", `<!doctype html><input name="cvc" autocomplete="cc-csc" placeholder="CVC">`);
    await open(`<h1>Pay</h1><p>Total due: <b>$1,042.10</b></p>
      <form><label>Shipping ZIP <input name="zip" autocomplete="shipping postal-code"></label>
      <iframe title="Secure card number" src="${fx.crossSiteUrl("/elements/number")}"></iframe>
      <iframe title="Secure expiration date" src="${fx.crossSiteUrl("/elements/expiry")}"></iframe>
      <iframe title="Secure CVC" src="${fx.crossSiteUrl("/elements/cvc")}"></iframe>
      <button>Pay $1,042.10</button></form>`);
    const remembered: string[] = [];
    expect(await pageShowsAmount("$1,042.10", deps(page))).toBe(true);
    const outcome = await fillCard(CARD, deps(page, remembered));
    expect(outcome).toEqual({ ok: true, filled: ["number", "exp", "cvc"], missing: [] });
    const frames = page.frames.all().filter((frame) => frame.id !== page.frames.mainFrameId);
    const byPath = (path: string) => frames.find((frame) => frame.url.endsWith(path))!.id;
    expect(await valueIn(page, byPath("/elements/number"), "input")).toBe(CARD.number);
    expect(await valueIn(page, byPath("/elements/expiry"), "input")).toBe("04/31");
    expect(await valueIn(page, byPath("/elements/cvc"), "input")).toBe("314");
    expect(await valueIn(page, page.frames.mainFrameId, "input[name=zip]")).toBe("");
    expect(remembered).toEqual([CARD.number, CARD.cvc]);
    await expect(page.screenshot()).rejects.toThrow(/still on this page/u);
    await expect(page.evaluate("1 + 1")).rejects.toThrow(/still on this page/u);
    expect((await page.snapshot()).tree).not.toContain(CARD.number);
    expect(await page.evaluateInFrame(page.frames.mainFrameId, `document.querySelectorAll("[data-omb-card]").length`, { whileSecret: true })).toBe(0);
  });

  it("fills a plain form, picks the month and year from their lists, and leaves fields outside the card's form", async () => {
    const other = await run.browser.newPage();
    const months = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${String(i + 1).padStart(2, "0")}</option>`).join("");
    const years = Array.from({ length: 10 }, (_, i) => `<option>${2026 + i}</option>`).join("");
    await open(`<p>Order total 42,00 €</p>
      <form id="shipping"><label>Postal code <input id="ship-zip" name="postal"></label><label>Name <input id="ship-name" name="fullname"></label></form>
      <form id="pay">
        <label for="n">Card number</label><input id="n" name="card_number">
        <select id="m" name="exp_month" aria-label="Expiry month"><option value="">Month</option>${months}</select>
        <select id="y" name="exp_year" aria-label="Expiry year"><option value="">Year</option>${years}</select>
        <label>Security code <input id="c" type="password" name="security_code"></label>
        <label>Name on card <input id="h" name="cardholder"></label>
        <input id="z" autocomplete="billing postal-code" name="zip">
      </form>`, other);
    expect(await pageShowsAmount("€42.00", deps(other))).toBe(true);
    expect(await pageShowsAmount("€24.00", deps(other))).toBe(false);
    const outcome = await fillCard(CARD, deps(other));
    expect(outcome).toEqual({ ok: true, filled: ["number", "expMonth", "expYear", "cvc", "name", "postal"], missing: [] });
    const main = other.frames.mainFrameId;
    expect(await valueIn(other, main, "#n")).toBe(CARD.number);
    expect(await valueIn(other, main, "#m")).toBe("4");
    expect(await valueIn(other, main, "#y")).toBe("2031");
    expect(await valueIn(other, main, "#c")).toBe("314");
    expect(await valueIn(other, main, "#h")).toBe("Ada Lovelace");
    expect(await valueIn(other, main, "#z")).toBe("94107");
    expect(await valueIn(other, main, "#ship-zip")).toBe("");
    expect(await valueIn(other, main, "#ship-name")).toBe("");
    await run.browser.closePage(other);
  });

  it("types nothing into a card number field that already holds a card, or on a page with none", async () => {
    const other = await run.browser.newPage();
    await open(`<form><input autocomplete="cc-number" value="•••• 4242"><input autocomplete="cc-csc"></form>`, other);
    expect(await fillCard(CARD, deps(other))).toEqual({ ok: false, reason: "prefilled" });
    expect(await valueIn(other, other.frames.mainFrameId, "[autocomplete=cc-csc]")).toBe("");
    await open(`<form><label>Email <input name="email"></label></form>`, other);
    expect(await fillCard(CARD, deps(other))).toEqual({ ok: false, reason: "no-fields" });
    await run.browser.closePage(other);
  });
});
