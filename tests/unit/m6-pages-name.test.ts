import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_NAME,
  PAGE_NAME_MAX,
  PAGE_NAME_REQUIRED_MESSAGE,
  clampPageName,
  defaultPageName,
  normalizePageName,
} from "@/lib/pages/name";

/**
 * M6-13 / M6-14: the one page-name helper, used by the rename field and by the server create code.
 * It has to agree with the database check `pages_name_format` (the pgTAP file 120 proves that side).
 */

const name = (raw: string) => {
  const result = normalizePageName(raw);
  if (!result.ok) throw new Error(`expected a name, got: ${result.message}`);
  return result.name;
};

describe("M6-13 normalizePageName", () => {
  it("trims the ends", () => {
    expect(name("Summer tour ")).toBe("Summer tour");
    expect(name("   Summer tour")).toBe("Summer tour");
    expect(name(" Summer tour ")).toBe("Summer tour");
  });

  it("collapses a newline, a tab and other control characters to one space", () => {
    expect(name("Summer\ntour")).toBe("Summer tour");
    expect(name("Summer\ttour")).toBe("Summer tour");
    expect(name("Summer\r\n\t\u0007tour")).toBe("Summer tour");
    expect(name("a\u0085b")).toBe("a b");
    expect(name("a\u2028b")).toBe("a b");
    // A control character at an end is trimmed away with the space it became.
    expect(name("\nSummer tour\n")).toBe("Summer tour");
  });

  it("drops bidi overrides and isolates (the database refuses them)", () => {
    expect(name("abc\u202Edef")).toBe("abcdef");
    expect(name("\u2066abc\u2069")).toBe("abc");
  });

  it("cuts a 70 character paste at 60 code points and counts an emoji as one", () => {
    expect(name("x".repeat(70))).toBe("x".repeat(60));
    expect(Array.from(name("😀".repeat(70)))).toHaveLength(60);
    expect(name("😀".repeat(60))).toBe("😀".repeat(60));
    // The cut never splits a surrogate pair.
    expect(name("😀".repeat(61))).toBe("😀".repeat(60));
    expect(PAGE_NAME_MAX).toBe(60);
  });

  it("trims again after the cut, so the stored name never ends with a space", () => {
    const raw = `${"x".repeat(59)} ${"y".repeat(10)}`;
    expect(name(raw)).toBe("x".repeat(59));
  });

  it("an empty or blank name is not a name: 'Add a name.'", () => {
    for (const raw of ["", "   ", "\n\t", "\u202E", " \u2066 "]) {
      expect(normalizePageName(raw)).toEqual({ ok: false, message: "Add a name." });
    }
    expect(PAGE_NAME_REQUIRED_MESSAGE).toBe("Add a name.");
  });

  it("keeps markup and punctuation as plain characters", () => {
    expect(name("<b>x</b>")).toBe("<b>x</b>");
    expect(name("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
    expect(name("Tom & Jerry's “tour”")).toBe("Tom & Jerry's “tour”");
  });

  it("everything it accepts satisfies the database check", () => {
    const check = (value: string) =>
      value === value.trim() &&
      Array.from(value).length >= 1 &&
      Array.from(value).length <= 60 &&
      !new RegExp(
        "[\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069]",
      ).test(value);
    for (const raw of [
      "a",
      " a ",
      "x".repeat(200),
      "a\nb\tc",
      "😀 tour",
      "\u202Ea\u202E",
      "  <i>  ",
    ]) {
      const result = normalizePageName(raw);
      if (result.ok) expect(check(result.name), JSON.stringify(raw)).toBe(true);
    }
  });
});

describe("M6-14 clampPageName (what the field holds while typing)", () => {
  it("does not trim, so a space between words survives typing", () => {
    expect(clampPageName("Summer ")).toBe("Summer ");
    expect(clampPageName("Summer tour")).toBe("Summer tour");
  });

  it("keeps a paste at 60 code points", () => {
    expect(Array.from(clampPageName("😀".repeat(70)))).toHaveLength(60);
    expect(clampPageName("x".repeat(70))).toHaveLength(60);
  });

  it("turns control characters into a space and drops bidi characters", () => {
    expect(clampPageName("a\nb")).toBe("a b");
    expect(clampPageName("a\u202Eb")).toBe("ab");
  });
});

describe("M6-13 defaultPageName", () => {
  it("the first site is Main site, later ones are Site 2 and Site 3 (M11-11)", () => {
    expect(DEFAULT_PAGE_NAME).toBe("Main site");
    expect(defaultPageName(1)).toBe("Main site");
    expect(defaultPageName(2)).toBe("Site 2");
    expect(defaultPageName(3)).toBe("Site 3");
    expect(defaultPageName(15)).toBe("Site 15");
  });

  it("a count that makes no sense falls back to Main site", () => {
    expect(defaultPageName(0)).toBe("Main site");
    expect(defaultPageName(-4)).toBe("Main site");
    expect(defaultPageName(2.5)).toBe("Main site");
    expect(defaultPageName(Number.NaN)).toBe("Main site");
  });
});
