import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_QR_STYLE,
  FRAME_TEXT_DEFAULT,
  FRAME_TEXT_MAX,
  QR_BLACK,
  QR_COLORS_MESSAGE,
  QR_MIN_CONTRAST,
  QR_WHITE,
  cleanFrameText,
  contrastRatio,
  customColor,
  isDefaultAppearance,
  isDefaultStyle,
  limitFrameText,
  pageColorsOf,
  qrColorsOk,
  requireHex,
  resolveAppearance,
  resolveColors,
} from "@/lib/qr/style";

/**
 * M9-25: the pure rules behind the QR card's Style group (src/lib/qr/style.ts): which color pairs
 * are allowed to scan, what the frame text may be, and how the controls' state becomes what a
 * drawing needs.
 */

describe("M9-25 qrColorsOk: the code must be darker than the background, at 4 to 1 or better", () => {
  const cases: [string, string, string, boolean][] = [
    ["black on white", "#000000", "#FFFFFF", true],
    ["dark blue on cream", "#0B2A5B", "#FBF6E9", true],
    ["Ivory page colors (ink on ivory)", "#1B1814", "#F7F3EC", true],
    ["Paper page colors (ink on paper)", "#16130F", "#FAF8F4", true],
    ["a three-digit hex is a hex color", "#000", "#FFF", true],
    ["no hash is still a hex color", "000000", "ffffff", true],
    ["gray #CCCCCC on white is too faint", "#CCCCCC", "#FFFFFF", false],
    ["white on black is inverted", "#FFFFFF", "#000000", false],
    ["a light code on a dark page is inverted", "#F7F3EC", "#1B1814", false],
    ["equal colors", "#336699", "#336699", false],
    ["equal after normalising", "#fff", "#FFFFFF", false],
    ["mid gray on white (3.5 to 1)", "#888888", "#FFFFFF", false],
    ["a hostile value in the code color", '#fff" onload="x', "#FFFFFF", false],
    ["a hostile value in the background", "#000000", '#fff" onload="x', false],
    ["a color name", "black", "white", false],
    ["an empty string", "", "#FFFFFF", false],
    ["an 8-digit hex (alpha) is not accepted", "#000000FF", "#FFFFFF", false],
    ["a script in the value", "<script>", "#FFFFFF", false],
  ];
  it.each(cases)("M9-25 %s: %s on %s is %s", (_name, code, background, ok) => {
    expect(qrColorsOk(code, background)).toBe(ok);
  });

  it("M9-25 the contrast ratio is the WCAG one: black on white is 21, equal colors are 1", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#336699", "#336699")).toBeCloseTo(1, 5);
    expect(contrastRatio("not a color", "#FFFFFF")).toBeNull();
    expect(QR_MIN_CONTRAST).toBe(4);
  });

  it("M9-25 the boundary: a pair just under 4 to 1 is refused and one just over is allowed", () => {
    // #777777 on white is 4.48 to 1; #808080 is 3.95 to 1.
    expect(contrastRatio("#777777", "#FFFFFF")!).toBeGreaterThan(4);
    expect(qrColorsOk("#777777", "#FFFFFF")).toBe(true);
    expect(contrastRatio("#808080", "#FFFFFF")!).toBeLessThan(4);
    expect(qrColorsOk("#808080", "#FFFFFF")).toBe(false);
  });

  it("M9-25 the note under the colors is the specified sentence", () => {
    expect(QR_COLORS_MESSAGE).toBe(
      "These colors may not scan. Use a darker code color on a lighter background.",
    );
  });
});

describe("M9-25 requireHex and customColor: nothing that is not a hex color gets through", () => {
  it("M9-25 requireHex returns upper-case #RRGGBB and throws for everything else", () => {
    expect(requireHex("#c9a86a")).toBe("#C9A86A");
    expect(requireHex("fff")).toBe("#FFFFFF");
    for (const bad of ['#fff" onload="x', "red", "", "#12345", "#1234567", "#GGGGGG", "url(x)"]) {
      expect(() => requireHex(bad), bad).toThrow();
    }
  });

  it("M9-25 customColor accepts a hex color string and nothing else", () => {
    expect(customColor("#0b2a5b")).toBe("#0B2A5B");
    for (const bad of [null, undefined, 0, {}, [], "nope", '#fff"', Number.NaN]) {
      expect(customColor(bad as unknown), String(bad)).toBeNull();
    }
  });
});

describe("M9-25 the frame text: one line, trimmed, at most 20 code points, empty means 'Scan me'", () => {
  it("M9-25 the default is Scan me and the limit is 20", () => {
    expect(FRAME_TEXT_DEFAULT).toBe("Scan me");
    expect(FRAME_TEXT_MAX).toBe(20);
  });

  it("M9-25 empty, spaces and breaks mean 'Scan me'", () => {
    for (const raw of ["", "   ", "\n", " \t\r\n ", "\u0000\u0007"]) {
      expect(cleanFrameText(raw), JSON.stringify(raw)).toBe("Scan me");
    }
  });

  it("M9-25 trims, and a line break or tab inside becomes one space", () => {
    expect(cleanFrameText("  Visit us  ")).toBe("Visit us");
    expect(cleanFrameText("Visit\nus")).toBe("Visit us");
    expect(cleanFrameText("Visit \t\r\n  us")).toBe("Visit us");
  });

  it("M9-25 cuts to 20 code points, so an emoji counts once", () => {
    expect(Array.from(cleanFrameText("a".repeat(50)))).toHaveLength(20);
    const emoji = "😀".repeat(30);
    expect(Array.from(cleanFrameText(emoji))).toHaveLength(20);
    expect(Array.from(limitFrameText(emoji))).toHaveLength(20);
    expect(limitFrameText("short")).toBe("short");
    // The field keeps what was typed (a trailing space too); drawing trims.
    expect(limitFrameText("abc ")).toBe("abc ");
  });

  it("M9-25 drops control and bidirectional characters", () => {
    expect(cleanFrameText("Sc\u0000an\u0007 me")).toBe("Sc an me");
    expect(cleanFrameText("a‮b‬c")).toBe("a b c");
  });

  it("M9-25 a markup string stays text (the SVG maker escapes it)", () => {
    expect(cleanFrameText("</text><script>alert(1)</script>")).toBe("</text><script>alert");
  });
});

describe("M9-25 the controls' state becomes what a drawing needs", () => {
  const page = { text: "#1B1814", bg: "#F7F3EC" };

  it("M9-25 the default style is black on white, no logo, no frame: the M6-31 look", () => {
    const appearance = resolveAppearance(DEFAULT_QR_STYLE, page);
    expect(appearance).toEqual(DEFAULT_APPEARANCE);
    expect(isDefaultAppearance(appearance)).toBe(true);
    expect(isDefaultStyle(DEFAULT_QR_STYLE)).toBe(true);
    expect([QR_BLACK, QR_WHITE]).toEqual(["#000000", "#FFFFFF"]);
  });

  it("M9-25 Page colors are the page's text for the modules and its bg for the background", () => {
    expect(resolveColors({ colors: "page", custom: DEFAULT_QR_STYLE.custom }, page)).toEqual({
      code: "#1B1814",
      background: "#F7F3EC",
    });
    // No usable page colors: black on white.
    expect(resolveColors({ colors: "page", custom: DEFAULT_QR_STYLE.custom }, null)).toEqual({
      code: QR_BLACK,
      background: QR_WHITE,
    });
  });

  it("M9-25 Custom are the two custom colors; Black and white ignores both the page and the custom ones", () => {
    const custom = { code: "#0B2A5B", background: "#FBF6E9" };
    expect(resolveColors({ colors: "custom", custom }, page)).toEqual(custom);
    expect(resolveColors({ colors: "bw", custom }, page)).toEqual({
      code: QR_BLACK,
      background: QR_WHITE,
    });
  });

  it("M9-25 anything that is not a hex color falls back to black on white, never into a drawing", () => {
    const bad = { code: '#fff" onload="x', background: "red" };
    expect(resolveColors({ colors: "custom", custom: bad }, page)).toEqual({
      code: QR_BLACK,
      background: QR_WHITE,
    });
    expect(resolveColors({ colors: "page", custom: bad }, { text: "x", bg: "y" })).toEqual({
      code: QR_BLACK,
      background: QR_WHITE,
    });
  });

  it("M9-25 Custom black on white with nothing else is still the default look", () => {
    const appearance = resolveAppearance(
      { ...DEFAULT_QR_STYLE, colors: "custom", custom: { code: "#000", background: "#fff" } },
      page,
    );
    expect(isDefaultAppearance(appearance)).toBe(true);
  });

  it("M9-25 a logo, a frame or other colors make it not the default; the frame text is cleaned", () => {
    expect(isDefaultAppearance({ ...DEFAULT_APPEARANCE, logo: true })).toBe(false);
    expect(isDefaultAppearance({ ...DEFAULT_APPEARANCE, frame: true })).toBe(false);
    expect(isDefaultAppearance({ ...DEFAULT_APPEARANCE, code: "#0B2A5B" })).toBe(false);
    const framed = resolveAppearance(
      { ...DEFAULT_QR_STYLE, frame: true, frameText: "  Visit\nus  " },
      page,
    );
    expect(framed.frameText).toBe("Visit us");
    expect(
      resolveAppearance({ ...DEFAULT_QR_STYLE, frame: true, frameText: "" }, page).frameText,
    ).toBe("Scan me");
  });

  it("M9-25 isDefaultStyle: every control back at its default, however the text is spelled", () => {
    expect(isDefaultStyle({ ...DEFAULT_QR_STYLE, logo: true })).toBe(false);
    expect(isDefaultStyle({ ...DEFAULT_QR_STYLE, frame: true })).toBe(false);
    expect(isDefaultStyle({ ...DEFAULT_QR_STYLE, colors: "page" })).toBe(false);
    expect(isDefaultStyle({ ...DEFAULT_QR_STYLE, frameText: "Hello" })).toBe(false);
    expect(isDefaultStyle({ ...DEFAULT_QR_STYLE, frameText: "  " })).toBe(true);
    expect(
      isDefaultStyle({ ...DEFAULT_QR_STYLE, custom: { code: "#112233", background: "#FFFFFF" } }),
    ).toBe(false);
  });
});

describe("M9-25 pageColorsOf: the page's text and bg tokens, as two hex colors or nothing", () => {
  it("M9-25 reads six-digit, three-digit and eight-digit (alpha dropped) hex", () => {
    expect(pageColorsOf({ text: "#1b1814", bg: "#f7f3ec" })).toEqual({
      text: "#1B1814",
      bg: "#F7F3EC",
    });
    expect(pageColorsOf({ text: "#000", bg: "#fff" })).toEqual({ text: "#000000", bg: "#FFFFFF" });
    expect(pageColorsOf({ text: "#1B181480", bg: "#F7F3ECFF" })).toEqual({
      text: "#1B1814",
      bg: "#F7F3EC",
    });
  });

  it("M9-25 either token that is not a hex color means no page colors", () => {
    expect(pageColorsOf({ text: "red", bg: "#FFFFFF" })).toBeNull();
    expect(pageColorsOf({ text: "#000000", bg: "linear-gradient(red, blue)" })).toBeNull();
    expect(pageColorsOf({ text: "", bg: "" })).toBeNull();
  });
});
