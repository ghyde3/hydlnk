import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FONT_ALLOWLIST, tokenSetSchema, type TokenSet } from "@/lib/theme";
import { contrastRatio, isLightColor, perceivedBrightness, relativeLuminance } from "@/lib/themes";
import { stackIsUp } from "./publish-support";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/**
 * M3-03 against the local database: every shipped system theme is a complete, valid token set with
 * allowlisted fonts and readable text, and the set has both light and dark backgrounds. Runs with
 * the secret key from .env.local and is skipped without the stack (REQUIRE_SUPABASE=1 makes a
 * missing stack fail).
 */
const { run } = await stackIsUp();

interface Row {
  id: string;
  name: string;
  owner_id: string | null;
  tokens: unknown;
}

describe.skipIf(!run)("M3-03 system themes (local Supabase)", () => {
  let rows: Row[] = [];
  let admin: SupabaseClient;

  const load = async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    const { data, error } = await admin
      .from("themes")
      .select("id, name, owner_id, tokens")
      .is("owner_id", null);
    expect(error).toBeNull();
    rows = data as Row[];
  };

  it("ships 6 to 8, with Noir, Ivory and Smoke among them, names unique and at most 40 characters", async () => {
    await load();
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.length).toBeLessThanOrEqual(8);
    const names = rows.map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining(["Noir", "Ivory", "Smoke"]));
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.length).toBeLessThanOrEqual(40);
  });

  it("every theme's tokens parse with the strict token schema (all 23 keys) and use allowlisted fonts", () => {
    for (const row of rows) {
      const parsed = tokenSetSchema.safeParse(row.tokens);
      expect(parsed.success, `${row.name}: ${parsed.success ? "" : parsed.error.message}`).toBe(
        true,
      );
      const tokens = row.tokens as TokenSet;
      expect(Object.keys(tokens)).toHaveLength(23);
      expect(FONT_ALLOWLIST as readonly string[]).toContain(tokens.fontHeading);
      expect(FONT_ALLOWLIST as readonly string[]).toContain(tokens.fontBody);
    }
  });

  it("text on bg and buttonText on buttonBg both reach contrast 4.5:1", () => {
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
    }
  });

  it("at least two themes have a light bg (luminance above 0.55) and two a dark one", () => {
    const bgs = rows.map((row) => (row.tokens as TokenSet).bg);
    // Both measures agree on the side of 0.55 for every shipped theme, so it holds whichever the
    // reader means by "luminance".
    for (const bg of bgs) {
      expect(perceivedBrightness(bg) > 0.55, bg).toBe(relativeLuminance(bg) > 0.55);
    }
    expect(bgs.filter((bg) => relativeLuminance(bg) > 0.55).length).toBeGreaterThanOrEqual(2);
    expect(bgs.filter((bg) => relativeLuminance(bg) <= 0.55).length).toBeGreaterThanOrEqual(2);
    expect(bgs.filter(isLightColor).length).toBeGreaterThanOrEqual(2);
  });

  it("Noir, Ivory and Smoke keep the values of Design.dc.html", () => {
    const by = (name: string) => rows.find((row) => row.name === name)!.tokens as TokenSet;
    expect(by("Noir")).toMatchObject({
      bg: "#16120E",
      surface: "#221B13",
      text: "#EFE8DC",
      accent: "#C9A86A",
      fontHeading: "Instrument Serif",
      buttonStyle: "outline",
      radius: 12,
      density: "regular",
      bgType: "solid",
    });
    expect(by("Ivory")).toMatchObject({
      bg: "#F3EEE4",
      fontHeading: "Fraunces",
      buttonStyle: "fill",
      radius: 4,
      density: "airy",
    });
    expect(by("Smoke")).toMatchObject({
      bg: "#1C2023",
      fontHeading: "Geist",
      buttonStyle: "pill",
      radius: 20,
      bgType: "gradient",
    });
  });

  it("the anon role (publishable key, no JWT) reads every system theme row", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await anon.from("themes").select("id, name, owner_id");
    expect(error).toBeNull();
    expect(new Set((data ?? []).map((row) => row.id))).toEqual(new Set(rows.map((row) => row.id)));
    expect((data ?? []).every((row) => row.owner_id === null)).toBe(true);
  });
});
