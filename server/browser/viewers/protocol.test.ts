import { describe, expect, it } from "vitest";

import { browserRestartRefusal, parseBrowserLiveAction } from "./protocol.ts";

describe("the v1 live view's protocol", () => {
  it("is refused while a busy bot still works in it, and allowed when it waits on the person there or the browser no longer answers", () => {
    expect(browserRestartRefusal(false, [])).toBeNull();
    expect(browserRestartRefusal(false, [{ waitingOnBrowser: false }])).toBe("Stop every bot using this profile before restarting its browser.");
    expect(browserRestartRefusal(false, [{ waitingOnBrowser: true }])).toBeNull();
    expect(browserRestartRefusal(false, [{ waitingOnBrowser: true }, { waitingOnBrowser: false }])).not.toBeNull();
    expect(browserRestartRefusal(true, [{ waitingOnBrowser: false }])).toBeNull();
  });

  it("maps only fixed navigation/tab verbs and rejects executable URLs and flags", () => {
    expect(parseBrowserLiveAction({ type: "navigate", url: "https://example.com/?q=hi", command: "eval", args: ["secret"] })).toEqual({ type: "command", args: ["open", "https://example.com/?q=hi"] });
    expect(parseBrowserLiveAction({ type: "tab-new" })).toEqual({ type: "command", args: ["tab", "new"] });
    expect(parseBrowserLiveAction({ type: "tab-select", tabId: "t2" })).toEqual({ type: "command", args: ["tab", "t2"] });
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "--cdp=9222", "https://a:secret@example.com", "https://example.com\n--headed", "http:\\example.com"]) expect(() => parseBrowserLiveAction({ type: "navigate", url })).toThrow();
    for (const body of [{ type: "eval", script: "1" }, { type: "press", key: "Control+a" }, { type: "tab-close", tabId: "--all" }, { type: "tab-select", tabId: 1 }, { type: "config", port: 1 }]) expect(() => parseBrowserLiveAction(body)).toThrow();
  });

  it("bounds input coordinates, text and modifiers, and strips arbitrary CDP fields", () => {
    expect(parseBrowserLiveAction({ type: "input_mouse", eventType: "mousePressed", x: 12, y: 20, button: "left", clickCount: 1, method: "Runtime.evaluate" })).toEqual({ type: "input", message: { type: "input_mouse", eventType: "mousePressed", x: 12, y: 20, button: "left", clickCount: 1, deltaX: 0, deltaY: 0, modifiers: 0 } });
    expect(parseBrowserLiveAction({ type: "input_keyboard", eventType: "keyDown", key: "a", text: "a" })).toEqual({ type: "input", message: { type: "input_keyboard", eventType: "keyDown", key: "a", text: "a", modifiers: 0, windowsVirtualKeyCode: 0 } });
    for (const body of [{ type: "input_mouse", eventType: "mouseMoved", x: Infinity, y: 1 }, { type: "input_mouse", eventType: "mouseMoved", x: -1, y: 1 }, { type: "input_keyboard", eventType: "keyDown", key: "a", modifiers: 16 }, { type: "input_keyboard", eventType: "keyDown", key: "a", text: "a".repeat(4097) }]) expect(() => parseBrowserLiveAction(body)).toThrow();
  });
});
