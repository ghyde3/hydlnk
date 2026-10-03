import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FONT_ALLOWLIST, tokenSetSchema, TOKEN_KEYS, type TokenSet } from "@/lib/theme";
import { contrastRatio, perceivedBrightness, relativeLuminance } from "@/lib/themes";
import { stackIsUp } from "./publish-support";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/**
 * M6-43 against the local database (extends M3-03, themes-system.test.ts): the sixteen system
 * themes are complete 26-key token sets that parse with the app's own schema, use allowlisted
 * fonts, keep text readable (WCAG 4.5:1) and give the picker real variety. The seven themes of
 * Milestones 0 and 3 are unchanged. The same checks run in SQL in supabase/tests/database/
 * 130-more-themes.test.sql. Skipped without the stack (REQUIRE_SUPABASE=1 makes that fail).
 */
const { run } = await stackIsUp();

interface Row {
  id: string;
  name: string;
  owner_id: string | null;
  tokens: unknown;
}

const ORDER = [
  "Noir",
  "Ivory",
  "Smoke",
  "Paper",
  "Sage",
  "Midnight",
  "Ember",
  "Linen",
  "Cloud",
  "Blush",
  "Citrus",
  "Graphite",
  "Ocean",
  "Plum",
  "Forest",
  "Sunset",
] as const;
const NEW_NAMES = ORDER.slice(7);
const idOf = (index: number) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;

/** The 23 values of the seven themes of Milestones 0 and 3, as stored after the M3 normalization. */
const ORIGINAL: Record<string, Record<string, unknown>> = {
  Noir: {
    bg: "#16120E",
    surface: "#221B13",
    text: "#EFE8DC",
    textMuted: "#A79E90",
    accent: "#C9A86A",
    buttonBg: "#C9A86A",
    buttonText: "#15110B",
    border: "#3A342D",
    fontHeading: "Instrument Serif",
    fontBody: "Geist",
    scale: 1,
    weightHeading: 400,
    letterCase: "normal",
    radius: 12,
    borderWidth: 1,
    buttonStyle: "outline",
    density: "regular",
    maxWidth: 480,
    align: "center",
    bgType: "solid",
    bgImage: null,
    overlayOpacity: 0,
    blur: 0,
  },
  Ivory: {
    bg: "#F3EEE4",
    surface: "#E6DDCD",
    text: "#1B1814",
    textMuted: "#5E564B",
    accent: "#1B1814",
    buttonBg: "#1B1814",
    buttonText: "#F7F3EC",
    border: "#CCC7BF",
    fontHeading: "Fraunces",
    fontBody: "Geist",
    scale: 1,
    weightHeading: 600,
    letterCase: "normal",
    radius: 4,
    borderWidth: 1,
    buttonStyle: "fill",
    density: "airy",
    maxWidth: 480,
    align: "center",
    bgType: "solid",
    bgImage: null,
    overlayOpacity: 0,
    blur: 0,
  },
  Smoke: {
    bg: "#1C2023",
    surface: "#262C30",
    text: "#E6EAEC",
    textMuted: "#9AA4AA",
    accent: "#9DB3C4",
    buttonBg: "#9DB3C4",
    buttonText: "#15110B",
    border: "#404447",
    fontHeading: "Geist",
    fontBody: "Geist",
    scale: 1,
    weightHeading: 600,
    letterCase: "normal",
    radius: 20,
    borderWidth: 1,
    buttonStyle: "pill",
    density: "regular",
    maxWidth: 480,
    align: "center",
    bgType: "gradient",
    bgImage: null,
    overlayOpacity: 0,
    blur: 0,
  },
  Paper: {
    bg: "#FBFAF7",
    surface: "#FFFFFF",
    text: "#17181A",
    textMuted: "#5A5D63",
    accent: "#2F4B9A",
    buttonBg: "#2F4B9A",
    buttonText: "#FFFFFF",
    border: "#E4E1D9",
    fontHeading: "Bricolage Grotesque",
    fontBody: "DM Sans",
    scale: 1,
    weightHeading: 700,
    letterCase: "normal",
    radius: 8,
    borderWidth: 1,
    buttonStyle: "fill",
    density: "regular",
    maxWidth: 480,
    align: "center",
    bgType: "solid",
    bgImage: null,
    overlayOpacity: 0,
    blur: 0,
  },
  Sage: {
    bg: "#E8EEE3",
    surface: "#D9E3D3",
    text: "#1D2A1E",
    textMuted: "#4F5F51",
    accent: "#35563C",
    buttonBg: "#35563C",
    buttonText: "#F4F8F1",
    border: "#C3D0BC",
    fontHeading: "Lora",
    fontBody: "DM Sans",
    scale: 1,
    weightHeading: 500,
    letterCase: "normal",
    radius: 20,
    borderWidth: 1,
    buttonStyle: "soft",
    density: "airy",
    maxWidth: 480,
    align: "center",
    bgType: "solid",
    bgImage: null,
    overlayOpacity: 0,
    blur: 0,
  },
  Midnight: {
    bg: "#0F1626",
    surface: "#18223A",
    text: "#E7ECF8",
    textMuted: "#9AA6C2",
    accent: "#7FA6FF",
    buttonBg: "#7FA6FF",
    buttonText: "#0B1020",
    border: "#2B3652",
    fontHeading: "Space Grotesk",
    fontBody: "Inter",
    scale: 1,
    weightHeading: 600,
    letterCase: "normal",
    radius: 12,
    borderWidth: 1,
    buttonStyle: "shadow",
    density: "regular",
    maxWidth: 480,
    align: "center",
    bgType: "gradient",
    bgImage: null,
    overlayOpacity: 0,
    blur: 0,
  },
  Ember: {
    bg: "#1B1412",
    surface: "#271C19",
    text: "#F3E9E2",
    textMuted: "#B8A79D",
    accent: "#E07A5F",
    buttonBg: "#E07A5F",
    buttonText: "#1B1412",
    border: "#3B2D29",
    fontHeading: "Playfair Display",
    fontBody: "Manrope",
    scale: 1,
    weightHeading: 700,
    letterCase: "normal",
    radius: 0,
    borderWidth: 1,
    buttonStyle: "outline",
    density: "compact",
    maxWidth: 480,
    align: "center",
    bgType: "solid",
    bgImage: null,
    overlayOpacity: 0,
    blur: 0,
  },
};

describe.skipIf(!run)("M6-43 sixteen system themes (local Supabase)", () => {
  let rows: Row[] = [];
  const tokensOf = (name: string) => rows.find((row) => row.name === name)!.tokens as TokenSet;

  it("reads sixteen system rows, in the order of their ids, with the fixed ids and unique short names", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const admin: SupabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await admin
      .from("themes")
      .select("id, name, owner_id, tokens")
      .is("owner_id", null)
      .order("id", { ascending: true });
    expect(error).toBeNull();
    rows = data as Row[];

    expect(rows).toHaveLength(16);
    expect(rows.map((row) => row.name)).toEqual([...ORDER]);
    rows.forEach((row, index) => expect(row.id).toBe(idOf(index)));
    expect(new Set(rows.map((row) => row.name)).size).toBe(16);
    for (const row of rows) expect(row.name.length).toBeLessThanOrEqual(40);
    // Linen to Sunset are ids 8 to 16, written the way the acceptance step names them.
    expect(rows[7]!.id).toBe("00000000-0000-4000-8000-000000000008");
    expect(rows[15]!.id).toBe("00000000-0000-4000-8000-000000000016");
  });

  it("the seven shipped themes keep their original 23 values", () => {
    for (const [name, original] of Object.entries(ORIGINAL)) {
      const stored = { ...(tokensOf(name) as Record<string, unknown>) };
      delete stored.gradientAngle;
      delete stored.gradientFrom;
      delete stored.gradientTo;
      expect(stored, name).toEqual(original);
    }
  });

  it("all sixteen are complete 26-key sets that parse with the strict schema, on allowlisted fonts", () => {
    for (const row of rows) {
      const parsed = tokenSetSchema.safeParse(row.tokens);
      expect(parsed.success, `${row.name}: ${parsed.success ? "" : parsed.error.message}`).toBe(
        true,
      );
      const tokens = row.tokens as Record<string, unknown>;
      expect(Object.keys(tokens).sort(), row.name).toEqual([...TOKEN_KEYS].sort());
      expect(Object.keys(tokens)).toHaveLength(26);
      for (const key of ["gradientAngle", "gradientFrom", "gradientTo"]) {
        expect(key in tokens, `${row.name} has ${key}`).toBe(true);
      }
      expect(FONT_ALLOWLIST as readonly string[]).toContain(tokens.fontHeading);
      expect(FONT_ALLOWLIST as readonly string[]).toContain(tokens.fontBody);
    }
  });

  it("text on bg, buttonText on buttonBg and textMuted on bg reach 4.5:1 in every theme", () => {
    for (const row of rows) {
      const t = row.tokens as TokenSet;
      expect(contrastRatio(t.text, t.bg), `${row.name} text on bg`).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(t.buttonText, t.buttonBg),
        `${row.name} buttonText on buttonBg`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(t.textMuted, t.bg),
        `${row.name} textMuted on bg`,
      ).toBeGreaterThanOrEqual(4.5);
      // Cards sit on the surface color.
      expect(
        contrastRatio(t.text, t.surface),
        `${row.name} text on surface`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("in a gradient theme text reaches 4.5:1 on both gradient colors (surface and bg when none is set)", () => {
    const gradient = rows.filter((row) => (row.tokens as TokenSet).bgType === "gradient");
    expect(gradient.map((row) => row.name)).toEqual(
      expect.arrayContaining(["Smoke", "Midnight", "Ocean", "Plum", "Sunset"]),
    );
    for (const row of gradient) {
      const t = row.tokens as TokenSet;
      const from = t.gradientFrom ?? t.surface;
      const to = t.gradientTo ?? t.bg;
      expect(
        contrastRatio(t.text, from),
        `${row.name} text on the first color`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(t.text, to),
        `${row.name} text on the last color`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(t.textMuted, from),
        `${row.name} textMuted on the first color`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(t.textMuted, to),
        `${row.name} textMuted on the last color`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("at least six themes have a light bg (luminance above 0.55) and at least six a dark one, by both measures", () => {
    const bgs = rows.map((row) => (row.tokens as TokenSet).bg);
    for (const bg of bgs) {
      expect(perceivedBrightness(bg) > 0.55, bg).toBe(relativeLuminance(bg) > 0.55);
    }
    expect(bgs.filter((bg) => relativeLuminance(bg) > 0.55).length).toBeGreaterThanOrEqual(6);
    expect(bgs.filter((bg) => relativeLuminance(bg) <= 0.55).length).toBeGreaterThanOrEqual(6);
  });

  it("Sunset, Ocean and Plum are gradient themes with explicit, different gradient colors", () => {
    for (const name of ["Sunset", "Ocean", "Plum"]) {
      const t = tokensOf(name);
      expect(t.bgType, name).toBe("gradient");
      expect(t.gradientFrom, name).toMatch(/^#[0-9A-F]{6}$/);
      expect(t.gradientTo, name).toMatch(/^#[0-9A-F]{6}$/);
      expect(t.gradientFrom).not.toBe(t.gradientTo);
    }
    // The solid themes keep the defaults, which follow the theme's own colors.
    for (const name of ["Linen", "Cloud", "Blush", "Citrus", "Graphite", "Forest"]) {
      const t = tokensOf(name);
      expect(t.bgType, name).toBe("solid");
      expect([t.gradientAngle, t.gradientFrom, t.gradientTo], name).toEqual([180, null, null]);
    }
  });

  it("all five button styles appear, the headings use at least ten fonts, no theme has a background image, and each set is under 8192 bytes", () => {
    const styles = new Set(rows.map((row) => (row.tokens as TokenSet).buttonStyle));
    expect([...styles].sort()).toEqual(["fill", "outline", "pill", "shadow", "soft"]);
    const headings = new Set(rows.map((row) => (row.tokens as TokenSet).fontHeading));
    expect(headings.size).toBeGreaterThanOrEqual(10);
    for (const row of rows) {
      const t = row.tokens as TokenSet;
      expect(t.bgImage, row.name).toBeNull();
      expect(t.bgType === "image", row.name).toBe(false);
      expect(new TextEncoder().encode(JSON.stringify(row.tokens)).length, row.name).toBeLessThan(
        8192,
      );
    }
  });

  it("each new theme looks like its name: the nine are distinct from each other and from the seven", () => {
    const seen = new Set(
      rows
        .slice(0, 7)
        .map((row) =>
          JSON.stringify([(row.tokens as TokenSet).bg, (row.tokens as TokenSet).accent]),
        ),
    );
    for (const name of NEW_NAMES) {
      const t = tokensOf(name);
      const key = JSON.stringify([t.bg, t.accent]);
      expect(seen.has(key), `${name} duplicates another theme's bg and accent`).toBe(false);
      seen.add(key);
    }
  });
});
