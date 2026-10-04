import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FONT_CATALOG } from "@/lib/design/fonts";
import {
  FONT_FILE_PATTERN,
  FONT_MANIFEST,
  UNICODE_RANGE_PATTERN,
  buildFontFaces,
  type FontManifest,
} from "@/lib/tenant-assets/fonts";
import { parseGoogleFontsCss } from "@/lib/tenant-assets/google-css";

/**
 * Wave J security review, low (defence in depth): a font's `unicode-range` goes from the manifest
 * straight into every page's inline <style>, and its file name into an unquoted url(). Both are
 * checked by shape, where the vendoring script reads Google's CSS, where the page builds its rules,
 * and in this gate over the committed manifest, so a hand-edited or corrupted manifest cannot reach
 * a page.
 */

const GOOD_RANGE = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+2000-206F,U+20AC,U+2212,U+FFFD";

function manifestWith(unicodeRange: string, file = "inter-latin.aaaaaaaaaaaa.woff2"): FontManifest {
  return {
    source: "test",
    families: {
      Inter: {
        license: "OFL-1.1",
        faces: [{ weight: 400, subset: "latin", unicodeRange, file, bytes: 1000 }],
      },
    },
  };
}
const TOKENS = { fontHeading: "Inter", fontBody: "Inter", weightHeading: 400 };

const googleCss = (range: string) => `/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v1/abc.woff2) format('woff2');
  unicode-range: ${range};
}`;

describe("the unicode-range shape", () => {
  it.each([
    "U+0000-00FF",
    "U+0131",
    "U+0000-00FF,U+0131,U+0152-0153",
    "U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116",
    "u+0100-02ba,u+2c60-2c7f",
    "U+4??",
    "U+0-FFFFF",
    GOOD_RANGE,
  ])("accepts %s", (range) => expect(UNICODE_RANGE_PATTERN.test(range)).toBe(true));

  it.each([
    "",
    "U+",
    "0000-00FF",
    "U+0000-00FF,",
    ",U+0000",
    "U+0000 U+0001",
    "U+0000-00FF;",
    "U+0000-00FF}",
    "U+0000}</style><script>alert(1)</script>",
    "U+0000/*",
    "U+0000-00FF,url(https://example.com/x)",
    "U+0000-00FF\nU+0001",
    "U+0000-0000000",
    "U+GGGG",
    "inherit",
  ])("rejects %j", (range) => expect(UNICODE_RANGE_PATTERN.test(range)).toBe(false));
});

describe("the vendoring script's reader refuses a bad range", () => {
  it("reads a good block", () => {
    expect(parseGoogleFontsCss(googleCss(GOOD_RANGE))[0]?.unicodeRange).toBe(GOOD_RANGE);
  });

  it.each([
    "U+0000-00FF, bogus",
    "U+0000-00FF,url(//evil)",
    "expression(alert(1))",
    "U+0000</style",
  ])("throws on %j", (range) => {
    expect(() => parseGoogleFontsCss(googleCss(range))).toThrow(/unicode-range/i);
  });
});

describe("the page builder never writes a face whose range or file name has the wrong shape", () => {
  it("a good face is written", () => {
    const css = buildFontFaces(TOKENS, manifestWith(GOOD_RANGE));
    expect(css).toContain(`unicode-range:${GOOD_RANGE}}`);
    expect(css).toContain('src:url(/_t/f/inter-latin.aaaaaaaaaaaa.woff2) format("woff2")');
  });

  it.each([
    "U+0000}</style><script>alert(1)</script>",
    "U+0000-00FF;background:url(//evil)",
    "",
    "latin",
  ])("a bad range %j is skipped, not copied into the style", (range) => {
    const css = buildFontFaces(TOKENS, manifestWith(range));
    expect(css).toBe("");
    expect(css).not.toContain("script");
  });

  it.each([
    "../../etc/passwd",
    "inter-latin.woff2",
    "inter latin.aaaaaaaaaaaa.woff2",
    "inter-latin.aaaaaaaaaaaa.woff2)",
    "inter-latin.AAAAAAAAAAAA.woff2",
    "inter-latin.aaaaaaaaaaaa.woff2?x=1",
    "Inter-latin.aaaaaaaaaaaa.woff2",
    "https://evil.example/f.aaaaaaaaaaaa.woff2",
  ])("a bad file name %j is skipped", (file) => {
    expect(buildFontFaces(TOKENS, manifestWith(GOOD_RANGE, file))).toBe("");
  });

  it("one bad face does not take the good ones of the family with it", () => {
    const manifest = manifestWith(GOOD_RANGE);
    manifest.families.Inter!.faces = [
      ...manifest.families.Inter!.faces,
      {
        weight: 400,
        subset: "latin-ext",
        unicodeRange: "U+0000;}",
        file: "inter-latin-ext.bbbbbbbbbbbb.woff2",
        bytes: 1,
      },
    ];
    const css = buildFontFaces(TOKENS, manifest);
    expect(css.match(/@font-face/g)).toHaveLength(1);
    expect(css).toContain("inter-latin.aaaaaaaaaaaa.woff2");
  });
});

describe("the committed manifest (the gate that stays green before and after `pnpm tenant-fonts`)", () => {
  it("every file name is {slug}.{12 hex}.woff2 and every unicode-range has the Google shape", () => {
    for (const [family, entry] of Object.entries(FONT_MANIFEST.families)) {
      for (const face of entry?.faces ?? []) {
        expect(FONT_FILE_PATTERN.test(face.file), `${family}: ${face.file}`).toBe(true);
        expect(
          UNICODE_RANGE_PATTERN.test(face.unicodeRange),
          `${family}: ${face.unicodeRange}`,
        ).toBe(true);
        expect(face.subset, `${family} subset`).toMatch(/^[a-z0-9-]+$/);
        expect(
          Number.isInteger(face.weight) && face.weight >= 100 && face.weight <= 900,
          `${family} weight`,
        ).toBe(true);
        expect(Number.isInteger(face.bytes) && face.bytes > 0, `${family} bytes`).toBe(true);
      }
    }
  });

  it("every family is one of the catalog's, with a license the vendoring script knows (SIL OFL 1.1 or Apache 2.0)", () => {
    const catalog = new Set<string>(FONT_CATALOG.map((font) => font.family));
    for (const [family, entry] of Object.entries(FONT_MANIFEST.families)) {
      expect(catalog.has(family), family).toBe(true);
      expect(["OFL-1.1", "Apache-2.0"], family).toContain(entry?.license);
    }
  });

  it("the manifest file on disk is the object the page reads", () => {
    const onDisk = JSON.parse(readFileSync("src/lib/tenant-assets/font-manifest.json", "utf8"));
    expect(FONT_MANIFEST).toEqual(onDisk);
  });
});
