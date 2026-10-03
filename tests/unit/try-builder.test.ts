import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIENCES } from "@/components/marketing/audiences/data";
import {
  DEFAULT_PRESET,
  TRY_BLOCK_KINDS,
  TRY_MAX_BLOCKS,
  buildTryDoc,
  presetBlocks,
  type TryPreset,
} from "@/components/marketing/try/sample-page";
import {
  ACCENT_IDS,
  BACKGROUND_IDS,
  FONT_PAIR_IDS,
  SHAPE_IDS,
  THEME_STYLE,
  TRY_THEMES,
  TRY_THEME_IDS,
  accentColors,
  styleOverrides,
  type TryStyle,
} from "@/components/marketing/try/themes";
import { initialTryState, tryReducer, type TryState } from "@/components/marketing/try/try-state";
import { BLOCK_ID_PATTERN, publishedDocSchema } from "@/lib/document";
import { tokenSetSchema } from "@/lib/theme";
import { contrastRatio, inkFor } from "@/lib/themes/color";

/**
 * The try-it builder (home page, landing pages). Its themes are copies of the system themes in the
 * database, so a test reads the migrations and fails if they drift. Its sample page is a real page
 * document, so every combination the visitor can reach has to pass the same schema a published page
 * does. The state changes are a plain reducer, tested here without a browser.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** `'<uuid>', null, '<Name>', '{...}'::jsonb` rows from a migration, by theme name. */
function themeRows(sql: string): Record<string, Record<string, unknown>> {
  const rows: Record<string, Record<string, unknown>> = {};
  const pattern = /'[0-9a-f-]{36}',\s*null,\s*'(\w+)',\s*'(\{[\s\S]*?\})'::jsonb/g;
  for (const match of sql.matchAll(pattern)) rows[match[1]!] = JSON.parse(match[2]!);
  return rows;
}

describe("try builder themes", () => {
  const stored = {
    ...themeRows(read("supabase/migrations/20261001000002_reference_data.sql")),
    ...themeRows(read("supabase/migrations/20261002100001_more_system_themes.sql")),
  };

  it("offers six themes, light and dark", () => {
    expect(TRY_THEMES.map((theme) => theme.id)).toEqual([...TRY_THEME_IDS]);
    expect(TRY_THEMES).toHaveLength(6);
  });

  it.each(TRY_THEMES.map((theme) => [theme.name, theme] as const))(
    "%s is a valid token set that matches its database row",
    (name, theme) => {
      expect(tokenSetSchema.safeParse(theme.tokens).success).toBe(true);
      const row = stored[name];
      expect(row, `${name} is a system theme in the migrations`).toBeDefined();
      // Milestone 0 stored "none" for no text transform; the legacy-values migration made it "normal".
      const expected = { ...row, letterCase: row!.letterCase === "none" ? "normal" : row!.letterCase };
      expect(theme.tokens).toEqual(expected);
    },
  );
});

describe("try builder accent colors", () => {
  it.each(TRY_THEMES.map((theme) => [theme.name, theme] as const))(
    "every accent reads on %s, and its button text on the accent",
    (_name, theme) => {
      const colors = accentColors(theme);
      for (const id of ACCENT_IDS) {
        const accent = colors[id];
        expect(contrastRatio(accent, theme.tokens.bg), `${id} on the page color`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(accent, theme.tokens.surface), `${id} on the card color`).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(inkFor(accent), accent), `${id} button text`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("an accent sets the accent, the button color and a readable button text", () => {
    const theme = TRY_THEMES[0]!;
    const overrides = styleOverrides(theme, { ...THEME_STYLE, accent: "purple" });
    const purple = accentColors(theme).purple;
    expect(overrides).toEqual({ accent: purple, buttonBg: purple, buttonText: inkFor(purple) });
  });

  it("the default style overrides nothing", () => {
    expect(styleOverrides(TRY_THEMES[0]!, THEME_STYLE)).toEqual({});
  });
});

describe("try builder sample page", () => {
  const everyKind = TRY_BLOCK_KINDS.filter((kind) => kind !== "image");

  function styles(): TryStyle[] {
    const all: TryStyle[] = [THEME_STYLE];
    for (const accent of [null, ...ACCENT_IDS])
      for (const fonts of FONT_PAIR_IDS)
        for (const shape of SHAPE_IDS)
          for (const background of BACKGROUND_IDS) all.push({ accent, fonts, shape, background });
    return all;
  }

  it("every theme with every style choice is a valid published page", () => {
    for (const theme of TRY_THEMES) {
      const blocks = presetBlocks({ blocks: everyKind });
      for (const style of styles()) {
        const doc = buildTryDoc({ themeId: theme.id, style, name: "", blocks });
        const parsed = publishedDocSchema.safeParse(doc);
        expect(parsed.success, `${theme.id} ${JSON.stringify(style)}`).toBe(true);
      }
    }
  });

  it("the default page and every kind of block but Image pass the publish schema", () => {
    const state = initialTryState();
    expect(publishedDocSchema.safeParse(buildTryDoc(state)).success).toBe(true);
    const all = presetBlocks({ blocks: everyKind });
    expect(all).toHaveLength(8);
    expect(publishedDocSchema.safeParse(buildTryDoc({ ...state, blocks: all })).success).toBe(true);
  });

  it("an Image block has no upload, so the page shows the renderer's placeholder for it", () => {
    const [image] = presetBlocks({ blocks: ["image"] });
    expect(image).toMatchObject({ type: "image", image: null });
  });

  it("every landing-page preset builds a valid page", () => {
    expect(AUDIENCES.length).toBeGreaterThan(0);
    for (const audience of AUDIENCES) {
      const preset = audience.preset;
      const state = initialTryState(preset);
      const blocks = state.blocks.filter((block) => block.type !== "image");
      const doc = buildTryDoc({ ...state, blocks }, preset);
      const parsed = publishedDocSchema.safeParse(doc);
      expect(parsed.success, `${audience.slug}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
      expect(TRY_THEME_IDS).toContain(preset.theme);
    }
  });

  it("block ids are valid and unique, on the server and after every add", () => {
    let state = initialTryState();
    for (const kind of TRY_BLOCK_KINDS) state = tryReducer(state, { type: "add", kind });
    const ids = state.blocks.flatMap((block) => [
      block.id,
      ...(block.type === "social" ? block.icons.map((icon) => icon.id) : []),
      ...(block.type === "grid" ? block.cells.map((cell) => cell.id) : []),
    ]);
    for (const id of ids) expect(id).toMatch(BLOCK_ID_PATTERN);
    expect(new Set(ids).size).toBe(ids.length);
    // Deterministic, so server and client render the same ids.
    expect(presetBlocks().map((block) => block.id)).toEqual(presetBlocks().map((block) => block.id));
  });

  it("the preset sets the theme, name, bio, social icons and link labels", () => {
    const preset: TryPreset = {
      theme: "noir",
      name: "Hollow Pines",
      bio: "Indie folk.",
      blocks: ["social", "link", "link"],
      socials: ["tiktok", "email"],
      linkLabels: ["Buy tickets", "Merch"],
    };
    const state = initialTryState(preset);
    expect(state.themeId).toBe("noir");
    const doc = buildTryDoc(state, preset);
    expect(doc.profile).toMatchObject({ name: "Hollow Pines", bio: "Indie folk." });
    const [social, first, second] = doc.blocks;
    expect(social).toMatchObject({ type: "social" });
    expect(social!.type === "social" && social!.icons.map((icon) => icon.platform)).toEqual(["tiktok", "email"]);
    expect([first, second].map((block) => block!.type === "link" && block!.label)).toEqual(["Buy tickets", "Merch"]);
    expect(doc.tokens.bg).toBe(TRY_THEMES.find((theme) => theme.id === "noir")!.tokens.bg);
  });

  it("the visitor's name replaces the preset's, and clearing it brings the preset's back", () => {
    const preset: TryPreset = { name: "Kai Brennan" };
    let state = initialTryState(preset);
    expect(buildTryDoc(state, preset).profile.name).toBe("Kai Brennan");
    state = tryReducer(state, { type: "name", value: "  Sam Lee " });
    expect(buildTryDoc(state, preset).profile.name).toBe("Sam Lee");
    state = tryReducer(state, { type: "name", value: "   " });
    expect(buildTryDoc(state, preset).profile.name).toBe("Kai Brennan");
  });
});

describe("try builder state", () => {
  const kinds = (state: TryState) => state.blocks.map((block) => block.type);

  it("starts on the default theme and blocks", () => {
    const state = initialTryState();
    expect(state.themeId).toBe(DEFAULT_PRESET.theme);
    expect(kinds(state)).toEqual([...DEFAULT_PRESET.blocks]);
    expect(state.style).toEqual(THEME_STYLE);
  });

  it("picking a theme restyles the page and clears the style tweaks", () => {
    let state = initialTryState();
    state = tryReducer(state, { type: "accent", value: "red" });
    state = tryReducer(state, { type: "shape", value: "pill" });
    expect(buildTryDoc(state).tokens.buttonStyle).toBe("pill");
    state = tryReducer(state, { type: "theme", id: "midnight" });
    expect(state.style).toEqual(THEME_STYLE);
    const tokens = buildTryDoc(state).tokens;
    expect(tokens.bg).toBe("#0F1626");
    expect(tokens.buttonStyle).toBe("shadow");
    expect(state.status).toBe("Midnight theme applied.");
  });

  it("style choices become page-level overrides on top of the theme", () => {
    let state = initialTryState();
    state = tryReducer(state, { type: "fonts", value: "classic" });
    state = tryReducer(state, { type: "shape", value: "square" });
    state = tryReducer(state, { type: "background", value: "gradient" });
    const tokens = buildTryDoc(state).tokens;
    expect(tokens).toMatchObject({
      fontHeading: "Playfair Display",
      fontBody: "Manrope",
      weightHeading: 700,
      radius: 0,
      bgType: "gradient",
    });
    // Back to the default: the theme's own values return.
    state = tryReducer(state, { type: "fonts", value: "theme" });
    expect(buildTryDoc(state).tokens.fontHeading).toBe("Lora");
  });

  it("adds a block at the end, with a fresh id, and says so", () => {
    let state = initialTryState();
    const before = state.blocks.length;
    state = tryReducer(state, { type: "add", kind: "divider" });
    expect(state.blocks).toHaveLength(before + 1);
    const added = state.blocks.at(-1)!;
    expect(added.type).toBe("divider");
    expect(state.lastAddedId).toBe(added.id);
    expect(state.status).toBe(`Added Divider. ${before + 1} blocks on the page.`);
  });

  it("two added links read differently, and an Image says it is a placeholder", () => {
    let state = initialTryState({ blocks: ["link"] });
    state = tryReducer(state, { type: "add", kind: "link" });
    state = tryReducer(state, { type: "add", kind: "link" });
    const labels = state.blocks.map((block) => block.type === "link" && block.label);
    expect(new Set(labels).size).toBe(3);
    state = tryReducer(state, { type: "add", kind: "image" });
    expect(state.status).toMatch(/placeholder/);
  });

  it(`holds at most ${TRY_MAX_BLOCKS} blocks`, () => {
    let state = initialTryState();
    for (let i = 0; i < 20; i += 1) state = tryReducer(state, { type: "add", kind: "text" });
    expect(state.blocks).toHaveLength(TRY_MAX_BLOCKS);
    expect(state.status).toMatch(/Remove one to add another/);
    expect(state.lastAddedId).toBeNull();
  });

  it("removes a block, and ids stay unique when one is added after", () => {
    let state = initialTryState();
    const [first, second] = state.blocks;
    state = tryReducer(state, { type: "remove", id: first!.id });
    expect(state.blocks[0]!.id).toBe(second!.id);
    state = tryReducer(state, { type: "add", kind: first!.type });
    const ids = state.blocks.map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(tryReducer(state, { type: "remove", id: "nope" })).toBe(state);
  });

  it("moves a block up and down, and stays put at the ends", () => {
    let state = initialTryState();
    const ids = () => state.blocks.map((block) => block.id);
    const [a, b, c] = ids();
    state = tryReducer(state, { type: "move", id: b!, direction: -1 });
    expect(ids().slice(0, 3)).toEqual([b, a, c]);
    state = tryReducer(state, { type: "move", id: b!, direction: -1 });
    expect(ids().slice(0, 3)).toEqual([b, a, c]);
    expect(state.status).toBe("Link is already first.");
    state = tryReducer(state, { type: "move", id: a!, direction: 1 });
    expect(ids().slice(0, 3)).toEqual([b, c, a]);
    const last = ids().at(-1)!;
    state = tryReducer(state, { type: "move", id: last, direction: 1 });
    expect(ids().at(-1)).toBe(last);
    expect(state.status).toMatch(/already last/);
  });

  it("start over restores the preset and keeps the name", () => {
    let state = initialTryState();
    state = tryReducer(state, { type: "name", value: "Sam" });
    state = tryReducer(state, { type: "theme", id: "ember" });
    state = tryReducer(state, { type: "add", kind: "grid" });
    state = tryReducer(state, { type: "reset" });
    expect(state.themeId).toBe(DEFAULT_PRESET.theme);
    expect(kinds(state)).toEqual([...DEFAULT_PRESET.blocks]);
    expect(state.name).toBe("Sam");
  });
});
