import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FONT_CATALOG } from "@/lib/design/fonts";
import { FONT_ALLOWLIST, SYSTEM_DEFAULT_TOKENS } from "@/lib/theme";
import {
  FONT_MANIFEST,
  buildFontFaces,
  buildFontPreloads,
  selectedFaces,
  tenantFontFaces,
  tenantFontPreloads,
  type FontManifest,
} from "@/lib/tenant-assets/fonts";
import { googleCssUrl, manifestRows, parseGoogleFontsCss } from "@/lib/tenant-assets/google-css";
import { readWoff2Names } from "@/lib/tenant-assets/woff2";

/**
 * M8-01: the theme fonts come from the page's own host. The builder is tested against a synthetic
 * manifest (so it runs before and after the files are vendored); the last block walks the real
 * manifest and the real files and is the gate that keeps a release from shipping system fonts.
 */

const root = process.cwd();
const FONT_DIR = join(root, "public/_t/f");

/** Three subsets per weight, the way Google splits a Latin family. */
function fixtureFamily(prefix: string, weights: number[]): FontManifest["families"][string] {
  return {
    license: "OFL-1.1",
    faces: weights.flatMap((weight) =>
      [
        ["latin-ext", "U+0100-02BA,U+2C60-2C7F"],
        ["latin", "U+0000-00FF,U+0131,U+0152-0153"],
      ].map(([subset, unicodeRange]) => ({
        weight,
        subset: subset!,
        unicodeRange: unicodeRange!,
        // A variable file serves every weight: the same name for each.
        file: `${prefix}-${subset}.aaaaaaaaaaaa.woff2`,
        bytes: 20000,
      })),
    ),
  };
}

const FIXTURE: FontManifest = {
  source: "test",
  families: {
    Fraunces: fixtureFamily("fraunces", [400, 500, 600, 700]),
    Inter: fixtureFamily("inter", [400, 500, 600, 700]),
    Geist: fixtureFamily("geist", [400, 500, 600, 700]),
    "Instrument Serif": fixtureFamily("instrument-serif", [400]),
  },
};

const rules = (css: string) => css.split("@font-face").filter(Boolean);

describe("M8-01 tenantFontFaces: only the faces the tokens select", () => {
  it("Fraunces 700 over Inter: the heading at 700 and the body at 400, each in every subset", () => {
    const css = buildFontFaces(
      { fontHeading: "Fraunces", fontBody: "Inter", weightHeading: 700 },
      FIXTURE,
    );
    const all = rules(css);
    expect(all).toHaveLength(4);
    expect(all.filter((rule) => rule.includes('font-family:"Fraunces"'))).toHaveLength(2);
    expect(all.filter((rule) => rule.includes("font-weight:700;"))).toHaveLength(2);
    expect(all.filter((rule) => rule.includes('font-family:"Inter"'))).toHaveLength(2);
    expect(all.filter((rule) => rule.includes("font-weight:400;"))).toHaveLength(2);
    for (const rule of all) {
      expect(rule).toContain("font-style:normal");
      expect(rule).toContain("font-display:swap");
      expect(rule).toMatch(/src:url\(\/_t\/f\/[a-z-]+\.aaaaaaaaaaaa\.woff2\) format\("woff2"\)/);
      expect(rule).toMatch(/unicode-range:U\+[0-9A-F,+U-]+\}$/);
    }
    // No weight the page does not use, no other family.
    expect(css).not.toMatch(/font-weight:(?:500|600);/);
    expect(css).not.toContain("Geist");
  });

  it("a family used for both roles is one set of rules at one weight, two when the weights differ", () => {
    const same = buildFontFaces(
      { fontHeading: "Inter", fontBody: "Inter", weightHeading: 400 },
      FIXTURE,
    );
    expect(rules(same)).toHaveLength(2);
    const both = buildFontFaces(
      { fontHeading: "Inter", fontBody: "Inter", weightHeading: 700 },
      FIXTURE,
    );
    expect(rules(both)).toHaveLength(4);
    expect(both).toContain("font-weight:700;");
    expect(both).toContain("font-weight:400;");
  });

  it("a different body family needs no 400 face of the heading family", () => {
    const css = buildFontFaces(
      { fontHeading: "Fraunces", fontBody: "Inter", weightHeading: 700 },
      FIXTURE,
    );
    expect(css).not.toMatch(/font-family:"Fraunces"[^}]*font-weight:400/);
  });

  it("uses the same nearestWeight rule as the editor's stylesheet URL", () => {
    expect(
      selectedFaces({ fontHeading: "Instrument Serif", fontBody: "Geist", weightHeading: 700 }),
    ).toEqual([
      { family: "Instrument Serif", weight: 400 },
      { family: "Geist", weight: 400 },
    ]);
    // Between two supported weights the lower wins on a tie.
    expect(
      selectedFaces({ fontHeading: "Fraunces", fontBody: "Inter", weightHeading: 550 })[0],
    ).toEqual({
      family: "Fraunces",
      weight: 500,
    });
    expect(
      selectedFaces({ fontHeading: "Fraunces", fontBody: "Inter", weightHeading: 700 })[0]!.weight,
    ).toBe(700);
  });

  it("depends on the font tokens alone", () => {
    const a = buildFontFaces(
      { fontHeading: "Fraunces", fontBody: "Inter", weightHeading: 700 },
      FIXTURE,
    );
    const b = buildFontFaces(
      {
        fontHeading: "Fraunces",
        fontBody: "Inter",
        weightHeading: 700,
        ...{ bg: "#000000", text: "x" },
      } as never,
      FIXTURE,
    );
    expect(a).toBe(b);
  });

  it("emits nothing for a family the manifest has no files for", () => {
    expect(
      buildFontFaces({ fontHeading: "Outfit", fontBody: "Sora", weightHeading: 600 }, FIXTURE),
    ).toBe("");
    expect(buildFontPreloads({ fontHeading: "Outfit", fontBody: "Sora" }, FIXTURE)).toEqual([]);
  });
});

/** The M3-01 and M3-04 table of hostile values, and every non-string. */
const HOSTILE: unknown[] = [
  "Geist;}body{x:y",
  "Geist, sans-serif",
  "Evil;}",
  "Fraunces;}",
  "x".repeat(200),
  "Comic Sans MS",
  "",
  " Geist",
  "geist",
  "constructor",
  "__proto__",
  "Geist\n",
  "url(https://evil.example/x.woff2)",
  undefined,
  null,
  0,
  42,
  true,
  {},
  { family: "Geist" },
  ["Geist"],
  Symbol.iterator,
];

describe("M8-01 hostile token values reach no rule, URL or attribute", () => {
  const defaults = buildFontFaces({}, FIXTURE);

  it.each(HOSTILE.map((value, index) => [index, value] as const))(
    "fontHeading and fontBody #%i fall back to the system default faces",
    (_index, value) => {
      const css = buildFontFaces(
        { fontHeading: value, fontBody: value, weightHeading: 400 },
        FIXTURE,
      );
      expect(css).toBe(
        buildFontFaces(
          {
            fontHeading: SYSTEM_DEFAULT_TOKENS.fontHeading,
            fontBody: SYSTEM_DEFAULT_TOKENS.fontBody,
            weightHeading: 400,
          },
          FIXTURE,
        ),
      );
      expect(css).not.toMatch(/Evil|x{20}|body\{|sans-serif|evil\.example|__proto__|constructor/);
      expect(buildFontPreloads({ fontHeading: value, fontBody: value }, FIXTURE)).toEqual(
        buildFontPreloads({}, FIXTURE),
      );
    },
  );

  it.each(["700;}", "700px", "abc", NaN, Infinity, -1, 1e9, null, undefined, {}, [], "<script>"])(
    "weightHeading %j is ignored or snapped to a supported weight",
    (weight) => {
      const css = buildFontFaces(
        { fontHeading: "Fraunces", fontBody: "Inter", weightHeading: weight },
        FIXTURE,
      );
      expect(css).not.toMatch(/[;}]\s*(?:<script|700px|abc)/);
      for (const match of css.matchAll(/font-weight:(\d+);/g)) {
        expect([400, 500, 600, 700]).toContain(Number(match[1]));
      }
    },
  );

  it("a missing tokens object is the system default", () => {
    expect(buildFontFaces(undefined as never, FIXTURE)).toBe(defaults);
    expect(buildFontFaces(null as never, FIXTURE)).toBe(defaults);
  });

  it("every family name in a rule is an allowlisted constant and every URL a manifest file", () => {
    for (const heading of FONT_ALLOWLIST) {
      const css = buildFontFaces(
        { fontHeading: heading, fontBody: "Inter", weightHeading: 400 },
        FIXTURE,
      );
      for (const match of css.matchAll(/font-family:"([^"]*)"/g)) {
        expect(FONT_ALLOWLIST as readonly string[]).toContain(match[1]);
      }
      for (const match of css.matchAll(/url\(([^)]*)\)/g)) {
        expect(match[1]).toMatch(/^\/_t\/f\/[a-z-]+\.[0-9a-f]{12}\.woff2$/);
      }
    }
  });
});

describe("M8-01 preloads: the latin file of each face the page uses, once", () => {
  it("one link per face, the same URLs as the @font-face rules", () => {
    const tokens = { fontHeading: "Fraunces", fontBody: "Inter", weightHeading: 700 };
    const urls = buildFontPreloads(tokens, FIXTURE);
    expect(urls).toEqual([
      "/_t/f/fraunces-latin.aaaaaaaaaaaa.woff2",
      "/_t/f/inter-latin.aaaaaaaaaaaa.woff2",
    ]);
    const css = buildFontFaces(tokens, FIXTURE);
    for (const url of urls) expect(css).toContain(`url(${url})`);
  });

  it("a variable file that serves two weights of a family is preloaded once", () => {
    expect(
      buildFontPreloads({ fontHeading: "Inter", fontBody: "Inter", weightHeading: 700 }, FIXTURE),
    ).toEqual(["/_t/f/inter-latin.aaaaaaaaaaaa.woff2"]);
  });

  it("never preloads latin-ext or any other subset (a page with ASCII text must not request them)", () => {
    for (const url of buildFontPreloads({ fontHeading: "Fraunces", fontBody: "Inter" }, FIXTURE)) {
      expect(url).not.toContain("latin-ext");
    }
  });
});

describe("M8-01 the vendoring helpers", () => {
  const SAMPLE = `
/* latin-ext */
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/fraunces/v38/abc-ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+1E00-1EFF;
}
/* latin */
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/fraunces/v38/abc.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
/* latin-ext */
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/fraunces/v38/abc-ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+1E00-1EFF;
}
/* latin */
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/fraunces/v38/abc.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}`;

  it("reads Google's CSS: subset from the comment, the range without spaces, one URL for two weights", () => {
    const faces = parseGoogleFontsCss(SAMPLE);
    expect(faces).toHaveLength(4);
    expect(faces[1]).toMatchObject({
      family: "Fraunces",
      subset: "latin",
      weightMin: 400,
      weightMax: 400,
      unicodeRange: "U+0000-00FF,U+0131",
    });
    expect(new Set(faces.map((face) => face.url)).size).toBe(2);
  });

  it("refuses a font file that is not on fonts.gstatic.com", () => {
    expect(() =>
      parseGoogleFontsCss(SAMPLE.replace("https://fonts.gstatic.com/", "https://evil.example/")),
    ).toThrow(/gstatic/);
  });

  it("builds one row per weight and subset, a shared file named once per subset", () => {
    const faces = parseGoogleFontsCss(SAMPLE);
    const rows = manifestRows(faces, [400, 700], (face) => ({
      file: `f-${face.subset}.000000000000.woff2`,
      bytes: 1,
    }));
    expect(rows.map((row) => `${row.weight}:${row.subset}`)).toEqual([
      "400:latin-ext",
      "400:latin",
      "700:latin-ext",
      "700:latin",
    ]);
  });

  it("a variable face with a weight range covers every requested weight inside it", () => {
    const block = (subset: string, range: string) => `/* ${subset} */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v20/${subset}.woff2) format('woff2');
  unicode-range: ${range};
}`;
    const variable = parseGoogleFontsCss(
      `${block("latin-ext", "U+0100-02BA")}\n${block("latin", "U+0000-00FF")}`,
    );
    const rows = manifestRows(variable, [400, 500, 700], (face) => ({
      file: `v-${face.subset}.000000000000.woff2`,
      bytes: 1,
    }));
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((row) => row.file)).size).toBe(2);
  });

  it("fails loudly when a requested weight has no file for a subset", () => {
    expect(() =>
      manifestRows(parseGoogleFontsCss(SAMPLE), [400, 600], () => ({ file: "x", bytes: 1 })),
    ).toThrow(/weight 600/);
  });

  it("builds the css2 URL the way tenantFontStylesheetUrl does for the editor", () => {
    expect(googleCssUrl("Plus Jakarta Sans", [700, 400])).toBe(
      "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700&display=swap",
    );
  });

  it("reads a woff2 file's name table (copyright, family, license) the way fontTools does", () => {
    const names = readWoff2Names(
      readFileSync(join(root, "design/showreel/assets/fonts/Fraunces-600-normal.woff2")),
    );
    expect(names.get(1)).toBe("Fraunces SemiBold");
    expect(names.get(0)).toBe(
      "Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces)",
    );
    expect(names.get(14)).toMatch(/scripts\.sil\.org\/OFL/);
    expect(() => readWoff2Names(Buffer.from("not a font"))).toThrow(/WOFF2/);
  });
});

describe("M8-01 scope: the live page's path never loads Google Fonts", () => {
  const sources = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.(?:ts|tsx|js)$/.test(entry.name) ? [path] : [];
    });
  const text = (path: string) => readFileSync(join(root, path), "utf8");

  it("no runtime module of the asset folder or the shared renderer names TenantFonts or Google Fonts", () => {
    // google-css, woff2 and build run in scripts only (the vendoring and the script build).
    const buildTime = /tenant-assets\/(?:google-css|woff2|build)\.ts$/;
    const runtime = [...sources("src/lib/tenant-assets"), ...sources("src/components/page")].filter(
      (path) => !buildTime.test(path),
    );
    expect(runtime.length).toBeGreaterThan(10);
    for (const path of runtime) {
      expect(text(path), path).not.toMatch(/from "\.\/(?:google-css|woff2|build)"/);
      expect(text(path), path).not.toMatch(
        /TenantFonts|GOOGLE_FONTS_API|GOOGLE_FONTS_STATIC|design\/font-url|fonts\.googleapis|fonts\.gstatic/,
      );
    }
  });

  it("the font and script builders appear in no editor, share or marketing module", () => {
    for (const dir of [
      "src/components/editor",
      "src/components/workspace",
      "src/components/marketing",
      "src/components/design",
      "src/app/(editor)",
      "src/app/(share)",
    ]) {
      if (!existsSync(join(root, dir))) continue;
      for (const path of sources(dir)) {
        expect(text(path), path).not.toMatch(
          /@\/lib\/tenant-assets|tenantFontFaces|tenantFontPreloads/,
        );
      }
    }
  });
});

describe("M8-01 the vendored fonts (the gate: red until `pnpm tenant-fonts` has been run)", () => {
  const notice = existsSync(join(FONT_DIR, "NOTICE.txt"))
    ? readFileSync(join(FONT_DIR, "NOTICE.txt"), "utf8")
    : "";

  it("the manifest was written by the vendoring script, not the placeholder", () => {
    expect(
      FONT_MANIFEST.source,
      "run `pnpm tenant-fonts` (needs network, see the script)",
    ).not.toMatch(/^pending/);
    expect(Object.keys(FONT_MANIFEST.families).sort()).toEqual([...FONT_ALLOWLIST].sort());
  });

  it("every family, every supported heading weight and every subset has a real file", () => {
    for (const entry of FONT_CATALOG) {
      const family = FONT_MANIFEST.families[entry.family];
      expect(family, `${entry.family} has no manifest entry`).toBeDefined();
      const subsets = new Set(family!.faces.map((face) => face.subset));
      expect(subsets.has("latin"), `${entry.family} has no latin subset`).toBe(true);
      for (const weight of entry.weights) {
        for (const subset of subsets) {
          const face = family!.faces.find((f) => f.weight === weight && f.subset === subset);
          expect(face, `${entry.family} ${weight} ${subset}`).toBeDefined();
        }
      }
      for (const face of family!.faces) {
        const path = join(FONT_DIR, face.file);
        expect(existsSync(path), `${face.file} is missing`).toBe(true);
        const bytes = readFileSync(path);
        expect(bytes.length, face.file).toBeGreaterThanOrEqual(1024);
        expect(bytes.length).toBe(face.bytes);
        expect(bytes.toString("latin1", 0, 4)).toBe("wOF2");
        const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
        expect(face.file, "the file name carries the hash of its bytes").toContain(`.${hash}.`);
        expect(face.unicodeRange).toMatch(
          /^U\+[0-9A-Fa-f?]+(?:-[0-9A-Fa-f]+)?(?:,U\+[0-9A-Fa-f?]+(?:-[0-9A-Fa-f]+)?)*$/,
        );
      }
    }
  });

  it("no unreferenced font file is left in public/_t/f", () => {
    if (!existsSync(FONT_DIR)) return;
    const referenced = new Set(
      Object.values(FONT_MANIFEST.families).flatMap((family) =>
        family!.faces.map((face) => face.file),
      ),
    );
    for (const name of readdirSync(FONT_DIR)) {
      if (name.endsWith(".woff2")) expect(referenced.has(name), name).toBe(true);
    }
  });

  it("every family has a license entry in the notices file shipped beside the fonts", () => {
    expect(notice, "public/_t/f/NOTICE.txt").not.toBe("");
    for (const family of FONT_ALLOWLIST) {
      expect(notice, family).toMatch(new RegExp(`^${family}\\n  License: `, "m"));
      expect(["OFL-1.1", "Apache-2.0"]).toContain(FONT_MANIFEST.families[family]?.license);
    }
  });

  it("the Fraunces 700 plus Inter 400 pair is at most 64 KB (Google: 36.5 KB + 23.8 KB)", () => {
    const pair = tenantFontPreloads({
      fontHeading: "Fraunces",
      fontBody: "Inter",
      weightHeading: 700,
    });
    expect(pair).toHaveLength(2);
    const total = pair.reduce((sum, url) => sum + statSync(join(root, "public", url)).size, 0);
    expect(total).toBeLessThanOrEqual(64 * 1024);
  });

  it("the real faces for the fixture pair are Fraunces 700 latin and Inter 400 latin, latin-ext on request only", () => {
    const css = tenantFontFaces({ fontHeading: "Fraunces", fontBody: "Inter", weightHeading: 700 });
    expect(css).toContain('font-family:"Fraunces"');
    expect(css).toContain("font-weight:700;");
    expect(css).toContain('font-family:"Inter"');
    expect(css.match(/unicode-range:/g)!.length).toBeGreaterThanOrEqual(4);
  });
});
