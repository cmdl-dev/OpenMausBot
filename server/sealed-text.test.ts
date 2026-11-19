import { describe, expect, it } from "vitest";

import { sealText, unsealText } from "./sealed-text.ts";

describe("sealed text", () => {
  it("opens with the key it was sealed with, and refuses another", () => {
    const sealed = sealText("{\"logins\":[]}", "a".repeat(64));
    expect(unsealText(sealed, "a".repeat(64))).toBe("{\"logins\":[]}");
    expect(() => unsealText(sealed, "b".repeat(64))).toThrow();
    expect(() => unsealText(Buffer.alloc(10), "a".repeat(64))).toThrow("too short");
  });
});
