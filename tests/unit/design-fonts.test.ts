import { describe, expect, it } from "vitest";
import {
  FONT_CATALOG,
  buildFontStylesheetUrl,
  allFontsStylesheetUrl,
  fontEntry,
  nearestWeight,
  supportedWeights,
  tenantFontStylesheetUrl,
} from "@/lib/design";
import { FONT_ALLOWLIST, tokenSetSchema } from "@/lib/theme";

/** M3-01: the allowlist, the stylesheet URL builder and the font token schemas. */

const HOSTILE = [
  "Comic Sans MS",
  "",
  "Geist;}body{x:y",
  "Geist, sans-serif",
  "x".repeat(200),
  "Geist\n",
  " Geist",
  "geist",
  "constructor",
  "__proto__",
];

describe("M3-01 font catalog", () => {
  it("exports at least 12 families with a category and a non-empty weight list each", () => {
    expect(FONT_CATALOG.length).toBeGreaterThanOrEqual(12);
    for (const entry of FONT_CATALOG) {
      expect(typeof entry.family).toBe("string");
      expect(["sans", "serif", "display", "mono"]).toContain(entry.category);
      expect(entry.weights.length).toBeGreaterThan(0);
      for (const weight of entry.weights) expect([400, 500, 600, 700]).toContain(weight);
    }
  });

  it("is exactly the FONT_ALLOWLIST of @/lib/theme, with no duplicates", () => {
    expect(FONT_CATALOG.map((entry) => entry.family)).toEqual([...FONT_ALLOWLIST]);
    expect(new Set(FONT_CATALOG.map((entry) => entry.family)).size).toBe(FONT_CATALOG.length);
  });

  it("includes the tenant fonts of Design.dc.html and at least 3 sans and 3 serif", () => {
    const families = FONT_CATALOG.map((entry) => entry.family);
    for (const name of ["Instrument Serif", "Fraunces", "Geist"]) expect(families).toContain(name);
    expect(FONT_CATALOG.filter((entry) => entry.category === "sans").length).toBeGreaterThanOrEqual(3);
    expect(FONT_CATALOG.filter((entry) => entry.category === "serif").length).toBeGreaterThanOrEqual(3);
  });

  it("looks a family up by exact name only", () => {
    expect(fontEntry("Geist")?.category).toBe("sans");
    for (const name of HOSTILE) expect(fontEntry(name)).toBeNull();
    expect(fontEntry(undefined)).toBeNull();
    expect(fontEntry({ family: "Geist" })).toBeNull();
  });
});

describe("M3-01 buildFontStylesheetUrl", () => {
  it("returns one css2 URL with exactly the two families and display=swap", () => {
    const built = buildFontStylesheetUrl(["Instrument Serif", "Geist"]);
    expect(built).toBe(
      "https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Geist&display=swap",
    );
    const url = new URL(built!);
    expect(url.origin + url.pathname).toBe("https://fonts.googleapis.com/css2");
    expect(url.searchParams.getAll("family")).toEqual(["Instrument Serif", "Geist"]);
    expect(url.searchParams.get("display")).toBe("swap");
    expect([...url.searchParams.keys()]).toEqual(["family", "family", "display"]);
  });

  it("emits a family passed twice once", () => {
    expect(buildFontStylesheetUrl(["Fraunces", "Fraunces"])).toBe(
      "https://fonts.googleapis.com/css2?family=Fraunces&display=swap",
    );
    expect(buildFontStylesheetUrl(["Geist", "Fraunces", "Geist"])).toBe(
      "https://fonts.googleapis.com/css2?family=Geist&family=Fraunces&display=swap",
    );
  });

  it.each(HOSTILE)("returns null for %j and never echoes it", (bad) => {
    expect(buildFontStylesheetUrl([bad])).toBeNull();
    expect(buildFontStylesheetUrl(["Geist", bad])).toBeNull();
    expect(buildFontStylesheetUrl([{ family: bad }])).toBeNull();
  });

  it("returns null for an empty list and for non-string entries", () => {
    expect(buildFontStylesheetUrl([])).toBeNull();
    expect(buildFontStylesheetUrl([null as never])).toBeNull();
    expect(buildFontStylesheetUrl([{ family: 5 as never }])).toBeNull();
  });

  it("adds weights only when asked, merges them per family and refuses unsupported ones", () => {
    expect(buildFontStylesheetUrl([{ family: "Geist", weights: [600, 400] }])).toBe(
      "https://fonts.googleapis.com/css2?family=Geist:wght@400;600&display=swap",
    );
    expect(buildFontStylesheetUrl([{ family: "Geist", weights: [400] }])).toBe(
      "https://fonts.googleapis.com/css2?family=Geist&display=swap",
    );
    expect(
      buildFontStylesheetUrl([{ family: "Geist", weights: [700] }, "Geist", "Inter"]),
    ).toBe("https://fonts.googleapis.com/css2?family=Geist:wght@700&family=Inter&display=swap");
    expect(buildFontStylesheetUrl([{ family: "Instrument Serif", weights: [600] }])).toBeNull();
    expect(buildFontStylesheetUrl([{ family: "Geist", weights: [650] }])).toBeNull();
  });

  it("builds a valid URL for every allowlisted family, and for all of them at once", () => {
    for (const entry of FONT_CATALOG) {
      const url = buildFontStylesheetUrl([entry.family]);
      expect(url).not.toBeNull();
      expect(new URL(url!).searchParams.getAll("family")).toEqual([entry.family]);
    }
    const all = new URL(allFontsStylesheetUrl());
    expect(all.searchParams.getAll("family")).toEqual([...FONT_ALLOWLIST]);
  });
});

describe("M3-01 tenantFontStylesheetUrl", () => {
  it("loads exactly the two chosen families for Noir (Instrument Serif and Geist)", () => {
    expect(
      tenantFontStylesheetUrl({
        fontHeading: "Instrument Serif",
        fontBody: "Geist",
        weightHeading: 400,
      }),
    ).toBe("https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Geist&display=swap");
  });

  it("emits a single family param when heading and body are the same family", () => {
    const url = new URL(
      tenantFontStylesheetUrl({ fontHeading: "Fraunces", fontBody: "Fraunces", weightHeading: 400 }),
    );
    expect(url.searchParams.getAll("family")).toEqual(["Fraunces"]);
  });

  it("adds the heading weight to the heading family when it is not the regular one", () => {
    const url = tenantFontStylesheetUrl({
      fontHeading: "Fraunces",
      fontBody: "Geist",
      weightHeading: 600,
    });
    expect(url).toBe(
      "https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600&family=Geist&display=swap",
    );
    // A weight the family lacks snaps to one it has.
    expect(
      tenantFontStylesheetUrl({ fontHeading: "Instrument Serif", fontBody: "Geist", weightHeading: 700 }),
    ).toBe("https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Geist&display=swap");
  });

  it("falls back to the default fonts for anything that is not allowlisted", () => {
    const url = tenantFontStylesheetUrl({
      fontHeading: "Evil;}" as never,
      fontBody: "x\"; @import url(//evil.example/a.css)" as never,
      weightHeading: 400,
    });
    expect(url).toBe("https://fonts.googleapis.com/css2?family=Inter&display=swap");
    expect(url).not.toContain("Evil");
    expect(url).not.toContain("evil");
  });
});

describe("M3-10 weights", () => {
  it("limits a family to the weights it ships", () => {
    expect(supportedWeights("Instrument Serif")).toEqual([400]);
    expect(supportedWeights("Space Mono")).toEqual([400, 700]);
    expect(supportedWeights("Geist")).toEqual([400, 500, 600, 700]);
    expect(supportedWeights("nope")).toEqual([400]);
  });

  it("snaps to the nearest supported weight, the lower on a tie", () => {
    expect(nearestWeight("Instrument Serif", 700)).toBe(400);
    expect(nearestWeight("Space Mono", 600)).toBe(700);
    expect(nearestWeight("Space Mono", 500)).toBe(400);
    expect(nearestWeight("Geist", 600)).toBe(600);
  });
});

describe("M3-01 fontHeading and fontBody schemas", () => {
  const { fontHeading, fontBody } = tokenSetSchema.shape;

  it("accept every allowlisted family", () => {
    for (const family of FONT_ALLOWLIST) {
      expect(fontHeading.safeParse(family).success).toBe(true);
      expect(fontBody.safeParse(family).success).toBe(true);
    }
  });

  it.each(HOSTILE)("reject %j", (bad) => {
    expect(fontHeading.safeParse(bad).success).toBe(false);
    expect(fontBody.safeParse(bad).success).toBe(false);
  });
});
