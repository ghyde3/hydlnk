import { describe, expect, it } from "vitest";
import { GOOGLE_FONTS_API, tenantFontStylesheetUrl } from "@/lib/design";
import { SYSTEM_DEFAULT_TOKENS, type TokenSet } from "@/lib/theme";
import { TEMPLATES, templateFontStylesheetUrl } from "@/lib/templates";

/**
 * M7-07, the one stylesheet the template picker loads: the families of all six themes together, in
 * one request, built only from allowlisted names.
 */

const themes = (): Record<string, Partial<TokenSet>> => ({
  [TEMPLATES[0]!.theme.id]: {
    fontHeading: "Instrument Serif",
    fontBody: "Geist",
    weightHeading: 400,
  },
  [TEMPLATES[1]!.theme.id]: { fontHeading: "Space Grotesk", fontBody: "Inter", weightHeading: 700 },
  [TEMPLATES[2]!.theme.id]: { fontHeading: "Fraunces", fontBody: "DM Sans", weightHeading: 600 },
  [TEMPLATES[3]!.theme.id]: {
    fontHeading: "Playfair Display",
    fontBody: "Lora",
    weightHeading: 700,
  },
  [TEMPLATES[4]!.theme.id]: { fontHeading: "Manrope", fontBody: "Manrope", weightHeading: 600 },
  [TEMPLATES[5]!.theme.id]: {
    fontHeading: "Bricolage Grotesque",
    fontBody: "Geist",
    weightHeading: 700,
  },
});

const families = (url: string): string[] =>
  [...new URL(url).searchParams.getAll("family")].map((value) => value.split(":")[0]!);

describe("M7-07 templateFontStylesheetUrl", () => {
  it("is one Google Fonts css2 URL that names the families of all six themes", () => {
    const url = templateFontStylesheetUrl(themes())!;
    expect(url.startsWith(`${GOOGLE_FONTS_API}/css2?`)).toBe(true);
    expect(url.endsWith("&display=swap")).toBe(true);
    expect(new Set(families(url))).toEqual(
      new Set([
        "Instrument Serif",
        "Geist",
        "Space Grotesk",
        "Inter",
        "Fraunces",
        "DM Sans",
        "Playfair Display",
        "Lora",
        "Manrope",
        "Bricolage Grotesque",
      ]),
    );
  });

  it("names a family once, with the weights the headings use", () => {
    const url = templateFontStylesheetUrl(themes())!;
    const all = families(url);
    expect(all.length).toBe(new Set(all).size);
    const raw = new URL(url).searchParams.getAll("family");
    // A 700 heading loads the regular weight as well as 700; a 400 serif is the bare name.
    expect(raw).toContain("Space Grotesk:wght@400;700");
    expect(raw).toContain("Instrument Serif");
  });

  it("with no theme loaded ({}) is the default fonts, still one URL, never null", () => {
    const url = templateFontStylesheetUrl({});
    expect(url).toBe(tenantFontStylesheetUrl(SYSTEM_DEFAULT_TOKENS));
    expect(families(url!)).toEqual(["Inter"]);
  });

  it("a font that is not on the allowlist falls back to the default family and never reaches the URL", () => {
    const evil = {
      [TEMPLATES[0]!.theme.id]: { fontHeading: "Evil;}body{x:y", fontBody: "Geist, sans-serif" },
    } as unknown as Record<string, Partial<TokenSet>>;
    const url = templateFontStylesheetUrl(evil)!;
    expect(url).not.toMatch(/Evil|body|%3B|%7D|,/i);
    expect(new Set(families(url))).toEqual(new Set(["Inter"]));
  });

  it("reads the catalog, so six templates are six themes at most", () => {
    const ids = new Set(TEMPLATES.map((template) => template.theme.id));
    expect(ids.size).toBe(6);
    // Themes that are not the templates' are not asked for.
    const url = templateFontStylesheetUrl({
      ...themes(),
      "00000000-0000-4000-8000-0000000000ff": { fontHeading: "Sora", fontBody: "Sora" },
    })!;
    expect(families(url)).not.toContain("Sora");
  });
});
