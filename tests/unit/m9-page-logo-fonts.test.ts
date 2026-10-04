import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FONT_CATALOG, HEADING_WEIGHTS, nearestWeight } from "@/lib/design";
import { FONT_ALLOWLIST } from "@/lib/theme";
import {
  NAME_FONT_PREVIEW_FILES,
  NAME_FONT_PREVIEW_PREFIX,
  nameFontPreviewCss,
} from "@/lib/design/name-font-files";
import { FONT_MANIFEST, buildFontPreloads, selectedFaces } from "@/lib/tenant-assets/fonts";
import { tenantFontStylesheetUrl } from "@/lib/design/font-url";

vi.mock("server-only", () => ({}));

/**
 * M9-24: what a name font costs. A page with a third family adds exactly that family's latin file
 * at the heading weight, and none of the 18 is large; the Design tab's Name font list draws each
 * option from the self-hosted files.
 */

const KB = 1024;
const latinOf = (family: string, weight: number) =>
  FONT_MANIFEST.families[family]!.faces.find(
    (face) => face.subset === "latin" && face.weight === weight,
  );

describe("M9-24 the latin file of each of the 18 families at each heading weight it supports", () => {
  it("covers all 18 families of the allowlist", () => {
    expect(FONT_CATALOG).toHaveLength(18);
    expect(FONT_CATALOG.map((e) => e.family)).toEqual([...FONT_ALLOWLIST]);
  });

  const rows = FONT_CATALOG.flatMap((entry) =>
    entry.weights.map((weight) => ({ family: entry.family, weight })),
  );

  it.each(rows)("$family at $weight has a latin file under 40 KB", ({ family, weight }) => {
    const face = latinOf(family, weight);
    expect(face, `${family} ${weight}`).toBeDefined();
    expect(face!.bytes).toBeLessThan(40 * KB);
    expect(existsSync(join(process.cwd(), "public/_t/f", face!.file))).toBe(true);
  });

  it("records the sizes (the largest is the budget's worst case for a third family)", () => {
    const sizes = FONT_CATALOG.map((entry) => {
      const w = nearestWeight(entry.family, 700);
      return `${entry.family} ${w}: ${latinOf(entry.family, w)!.bytes}`;
    });
    // The assets budget for a page with a third family: 115 KB in all, 3 fonts, 7 requests.
    const largest = Math.max(
      ...FONT_CATALOG.map((e) => latinOf(e.family, nearestWeight(e.family, 700))!.bytes),
    );
    expect(largest).toBeLessThan(40 * KB);
    console.log(`M9-24 latin file at the heading weight 700 (bytes):\n${sizes.join("\n")}`);
  });
});

describe("M9-24 the faces a page loads", () => {
  const tokens = { fontHeading: "Fraunces", fontBody: "Inter", weightHeading: 700 };

  it("no name font: the heading at its weight and the body at 400, as before", () => {
    expect(selectedFaces(tokens)).toEqual([
      { family: "Fraunces", weight: 700 },
      { family: "Inter", weight: 400 },
    ]);
  });

  it("a name font equal to the heading font adds nothing", () => {
    expect(selectedFaces({ ...tokens, nameFont: "Fraunces" })).toEqual(selectedFaces(tokens));
  });

  it("a third family adds one face, at the heading weight its family supports", () => {
    expect(selectedFaces({ ...tokens, nameFont: "Lora" })).toEqual([
      ...selectedFaces(tokens),
      { family: "Lora", weight: 700 },
    ]);
    // A family without the weight takes the nearest it ships.
    expect(selectedFaces({ ...tokens, nameFont: "Instrument Serif" })).toEqual([
      ...selectedFaces(tokens),
      { family: "Instrument Serif", weight: 400 },
    ]);
    expect(selectedFaces({ ...tokens, nameFont: "Space Mono" }).at(-1)).toEqual({
      family: "Space Mono",
      weight: 700,
    });
  });

  it("a name font equal to the body font adds the face only when the heading weight is not the body's 400", () => {
    expect(selectedFaces({ ...tokens, nameFont: "Inter" })).toEqual([
      ...selectedFaces(tokens),
      { family: "Inter", weight: 700 },
    ]);
    expect(selectedFaces({ ...tokens, weightHeading: 400, nameFont: "Inter" })).toEqual(
      selectedFaces({ ...tokens, weightHeading: 400 }),
    );
  });

  it("a name font that is not on the allowlist adds nothing and writes nothing", () => {
    for (const nameFont of ["Comic Sans", "x;}</style>", "", null, undefined, 3, {}]) {
      expect(selectedFaces({ ...tokens, nameFont })).toEqual(selectedFaces(tokens));
    }
  });

  it("preloads one latin file per face, the name font's last, all from the page's own host", () => {
    const base = buildFontPreloads(tokens);
    const third = buildFontPreloads({ ...tokens, nameFont: "Lora" });
    expect(third.slice(0, base.length)).toEqual(base);
    expect(third).toHaveLength(base.length + 1);
    expect(third.at(-1)).toMatch(/^\/_t\/f\/lora-latin\.[0-9a-f]{12}\.woff2$/);
    for (const url of third) expect(url.startsWith("/_t/f/")).toBe(true);
  });

  it("the editor's preview stylesheet asks for the name font at the same weight, and only allowlisted names", () => {
    const base = tenantFontStylesheetUrl(tokens as never);
    const third = tenantFontStylesheetUrl(tokens as never, "Lora");
    expect(third).toContain("family=Lora:wght@700");
    expect(third.startsWith(base.split("&display")[0]!)).toBe(true);
    expect(tenantFontStylesheetUrl(tokens as never, "Comic Sans")).toBe(base);
    expect(tenantFontStylesheetUrl(tokens as never, "Fraunces")).toBe(base);
    expect(HEADING_WEIGHTS).toContain(700);
  });
});

describe("M9-24 the Name font list draws each option from the self-hosted files", () => {
  const css = nameFontPreviewCss();

  it("has one latin regular face per family, from /_t/f/, under the preview alias, and nothing else", () => {
    const faces = [...css.matchAll(/@font-face\{font-family:"([^"]+)"/g)].map((m) => m[1]);
    expect(faces).toEqual(FONT_CATALOG.map((e) => `${NAME_FONT_PREVIEW_PREFIX}${e.family}`));
    expect((css.match(/url\(\/_t\/f\/[a-z0-9-]+-latin\.[0-9a-f]{12}\.woff2\)/g) ?? []).length).toBe(
      18,
    );
    expect(css).not.toMatch(/https?:|fonts\.g|-latin-ext|[<>]/);
  });

  it("holds the table to the vendored manifest and to the files on disk (re-vendoring the fonts shows up here)", () => {
    expect(Object.keys(NAME_FONT_PREVIEW_FILES)).toEqual([...FONT_ALLOWLIST]);
    for (const family of FONT_ALLOWLIST) {
      const manifest = latinOf(family, 400)!;
      expect(NAME_FONT_PREVIEW_FILES[family], family).toBe(manifest.file);
      expect(existsSync(join(process.cwd(), "public/_t/f", manifest.file)), family).toBe(true);
    }
  });

  it("the editor's select and the tenant asset builders stay apart: the design library never imports them", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/design/name-font-files.ts"), "utf8");
    expect(source).not.toMatch(/@\/lib\/tenant-assets|font-manifest|server-only/);
  });
});
