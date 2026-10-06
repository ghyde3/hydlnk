import { describe, expect, it } from "vitest";
import { claimHint, DEFAULT_IDLE_HINT } from "@/components/marketing/claim-hint";

describe("claimHint", () => {
  it("shows the idle line while the field is empty or blank", () => {
    for (const raw of ["", "   "]) {
      expect(claimHint(raw)).toEqual({ kind: "idle", message: DEFAULT_IDLE_HINT, invalid: false });
    }
    expect(claimHint("", "Custom line").message).toBe("Custom line");
  });

  it("asks for more characters under 3 (also when only symbols are typed)", () => {
    for (const raw of ["w", "wr", "ab", "!!", "___"]) {
      const hint = claimHint(raw);
      expect(hint.kind).toBe("short");
      expect(hint.message).toBe("Use at least 3 letters, numbers or dashes.");
      expect(hint.invalid).toBe(false);
    }
  });

  it("says sign-up checks the name next, and never says it is available", () => {
    for (const raw of ["wren", "Wren", "wren-haven", "abc", "a".repeat(30)]) {
      const hint = claimHint(raw);
      expect(hint.kind).toBe("ok");
      expect(hint.message).toBe("Next, we check that it’s available.");
      expect(hint.invalid).toBe(false);
    }
  });

  it("names the address it will use when the typed text gets cleaned up, like sign-up does", () => {
    expect(claimHint("Wren_Haven")).toMatchObject({
      kind: "changed",
      message: "We’ll use wrenhaven.hydlnk.com.",
    });
    expect(claimHint(" mara okafor ").message).toBe("We’ll use maraokafor.hydlnk.com.");
    // Case alone is not worth a remark.
    expect(claimHint("MARA").kind).toBe("ok");
  });

  it("flags a name sign-up would refuse", () => {
    expect(claimHint("-wren")).toEqual({
      kind: "invalid",
      message: "Handles can’t start or end with a dash.",
      invalid: true,
    });
    expect(claimHint("wren-").kind).toBe("invalid");
    expect(claimHint("xn--wren")).toMatchObject({
      kind: "invalid",
      message: "Handles can’t start with xn--.",
      invalid: true,
    });
    expect(claimHint("a".repeat(31))).toEqual({
      kind: "too_long",
      message: "Handles can be up to 30 characters.",
      invalid: true,
    });
  });

  it("never uses the words available, free or taken to describe a name's status", () => {
    // "Free forever" is the idle reassurance about the plan, not about a name.
    for (const raw of ["", "w", "wren", "Wren_Haven", "-wren", "a".repeat(40)]) {
      const { message, kind } = claimHint(raw);
      if (kind === "idle") continue;
      expect(message).not.toMatch(/\bis (available|free)\b|\btaken\b/i);
    }
  });
});
