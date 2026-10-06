import { describe, expect, it } from "vitest";
import { emptyDraft, toPublishForm, type DraftDoc } from "@/lib/document";
import { SYSTEM_DEFAULT_TOKENS, resolveTokens, type TokenSet } from "@/lib/theme";
import type { ThemeRow } from "@/lib/themes";
import { previewForm } from "@/lib/themes/preview";
import { swatchBackground } from "@/lib/themes/swatch";

/**
 * M6-44: the preview model is a pure function of the draft and a theme row. M6-43: the swatch of a
 * theme card draws the theme's own background or gradient.
 */

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

const PAPER: ThemeRow = {
  id: "00000000-0000-4000-8000-000000000004",
  name: "Paper",
  system: true,
  tokens: { bg: "#FBFAF7", accent: "#2F4B9A", radius: 8, fontHeading: "Bricolage Grotesque" },
};

function draft(): DraftDoc {
  const base = emptyDraft("mara");
  return {
    ...base,
    rev: 7,
    profile: { ...base.profile, name: "Mara Okafor", bio: "Portrait photographer" },
    theme: {
      ref: "00000000-0000-4000-8000-000000000001",
      overrides: { accent: "#C46A4F", radius: 20 },
    },
    blocks: [
      {
        id: "Bt5rJ1fGz6Os",
        type: "link",
        visible: true,
        label: "Book",
        url: "https://example.com/book",
        overrides: { buttonStyle: "fill" },
      },
      { id: "Hd7mN3cYb8Ue", type: "header", visible: true, text: "Hidden section" },
      {
        id: "Qw8vC2nKd4Ly",
        type: "link",
        visible: false,
        label: "Not shown",
        url: "https://example.com/x",
      },
    ],
  };
}

describe("M6-44 the preview model", () => {
  it("is toPublishForm of the draft with theme { ref: <the theme's id>, overrides: {} }", () => {
    const doc = draft();
    expect(previewForm(doc, PAPER)).toEqual(
      toPublishForm({ ...doc, theme: { ref: PAPER.id, overrides: {} } }, PAPER.tokens),
    );
  });

  it("uses the theme's tokens, leaves the page-level overrides out and keeps every block's own style", () => {
    const form = previewForm(draft(), PAPER);
    expect(form.theme).toEqual({ ref: PAPER.id, overrides: {} });
    expect(form.tokens).toEqual(resolveTokens(PAPER.tokens, {}));
    expect(form.tokens.accent).toBe("#2F4B9A");
    expect(form.tokens.radius).toBe(8);
    const link = form.blocks.find((block) => block.id === "Bt5rJ1fGz6Os");
    expect(link).toMatchObject({ type: "link", overrides: { buttonStyle: "fill" } });
    // The real profile and the visible blocks, like the page itself.
    expect(form.profile.name).toBe("Mara Okafor");
    expect(form.blocks.map((block) => block.id)).toEqual(["Bt5rJ1fGz6Os", "Hd7mN3cYb8Ue"]);
  });

  it("does not mutate a deep-frozen draft or the theme row", () => {
    const doc = deepFreeze(draft());
    const row = deepFreeze({ ...PAPER, tokens: { ...PAPER.tokens } });
    const before = JSON.stringify(doc);
    expect(() => previewForm(doc, row)).not.toThrow();
    expect(JSON.stringify(doc)).toBe(before);
    expect(doc.theme.overrides).toEqual({ accent: "#C46A4F", radius: 20 });
  });

  it("a theme row with no readable tokens previews as the default theme", () => {
    const empty: ThemeRow = { id: "x", name: "Broken", system: false, tokens: {} };
    expect(previewForm(draft(), empty).tokens).toEqual(SYSTEM_DEFAULT_TOKENS);
  });

  it("two calls give equal forms (it is a function of its inputs)", () => {
    const doc = draft();
    expect(previewForm(doc, PAPER)).toEqual(previewForm(doc, PAPER));
  });
});

const tokens = (over: Partial<TokenSet>): TokenSet => ({ ...SYSTEM_DEFAULT_TOKENS, ...over });

describe("M6-43 the swatch background", () => {
  it("a solid theme shows its bg color, and so does an image theme", () => {
    expect(swatchBackground(tokens({ bg: "#F3EEE4" }))).toBe("#F3EEE4");
    expect(swatchBackground(tokens({ bg: "#101010", bgType: "image" }))).toBe("#101010");
  });

  it("a gradient with no colors of its own is surface at 0% to bg at 55%, top to bottom, whatever the angle", () => {
    const smoke = tokens({ bgType: "gradient", bg: "#1C2023", surface: "#262C30" });
    expect(swatchBackground(smoke)).toBe("linear-gradient(180deg, #262C30 0%, #1C2023 55%)");
    expect(swatchBackground({ ...smoke, gradientAngle: 90 })).toBe(
      "linear-gradient(180deg, #262C30 0%, #1C2023 55%)",
    );
  });

  it("a gradient with colors of its own runs from the first to the last along its angle", () => {
    const plum = tokens({
      bgType: "gradient",
      bg: "#2A1245",
      surface: "#3A1C5C",
      gradientAngle: 135,
      gradientFrom: "#2A1245",
      gradientTo: "#6B2F7A",
    });
    expect(swatchBackground(plum)).toBe("linear-gradient(135deg, #2A1245 0%, #6B2F7A 100%)");
  });

  it("a missing side follows the page: surface first, bg last", () => {
    const half = tokens({
      bgType: "gradient",
      bg: "#111111",
      surface: "#222222",
      gradientFrom: "#C46A4F",
    });
    expect(swatchBackground(half)).toBe("linear-gradient(180deg, #C46A4F 0%, #111111 100%)");
    const other = tokens({
      bgType: "gradient",
      bg: "#111111",
      surface: "#222222",
      gradientTo: "#C46A4F",
    });
    expect(swatchBackground(other)).toBe("linear-gradient(180deg, #222222 0%, #C46A4F 100%)");
  });

  it("a token set built by hand without the gradient keys still draws", () => {
    expect(swatchBackground({ bg: "#111111", surface: "#222222", bgType: "gradient" })).toBe(
      "linear-gradient(180deg, #222222 0%, #111111 55%)",
    );
  });
});
