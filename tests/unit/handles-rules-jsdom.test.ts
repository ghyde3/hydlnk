// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { handleDisplayHost, normalizeHandle, validateHandle } from "@/lib/handles/rules";

/**
 * M1-01 step 5: the module a client form imports also loads and works in a jsdom environment
 * (handles-rules.test.ts runs it in plain node, as server actions do).
 */
describe("M1-01 handle rules in a jsdom environment", () => {
  it("runs in a browser-like environment", () => {
    expect(typeof window).toBe("object");
    expect(typeof document).toBe("object");
  });

  it("normalizes and validates exactly as in node", () => {
    expect(normalizeHandle("Mara_Studio!")).toBe("marastudio");
    expect(validateHandle("marastudio")).toBe("ok");
    expect(validateHandle("ab")).toBe("short");
    expect(validateHandle("a".repeat(31))).toBe("too_long");
    expect(validateHandle("-mara")).toBe("invalid");
    expect(validateHandle("xn--pple-43d")).toBe("invalid");
    expect(handleDisplayHost("mara")).toBe("mara.hydlnk.com");
  });
});
