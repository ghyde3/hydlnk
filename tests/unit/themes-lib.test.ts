import { describe, expect, it } from "vitest";
import {
  draftDocSchema,
  publishDocSchema,
  toPublishForm,
  type DraftDoc,
  type LinkBlock,
} from "@/lib/document";
import {
  BLOCK_OVERRIDE_KEYS,
  SYSTEM_DEFAULT_TOKENS,
  resolveBlockTokens,
  resolveTokens,
  type TokenSet,
} from "@/lib/theme";
import {
  EMPTY_NAME_MESSAGE,
  INK_ON_DARK,
  INK_ON_LIGHT,
  cardTag,
  checkThemeName,
  contrastRatio,
  friendlyPublishError,
  inkFor,
  isEdited,
  isLightColor,
  mediaPathOf,
  nextThemeName,
  overrideChipLabel,
  perceivedBrightness,
  readButtonStyle,
  readColor,
  readRadius,
  relativeLuminance,
  savedThemeLimitMessage,
  setButtonStyle,
  setColor,
  setRadius,
  themeStatusLabel,
  themeTokensFor,
  type ThemeRow,
} from "@/lib/themes";

const NOIR: TokenSet = {
  ...SYSTEM_DEFAULT_TOKENS,
  bg: "#16120E",
  accent: "#C9A86A",
  buttonStyle: "outline",
  radius: 12,
};
const IVORY: TokenSet = {
  ...SYSTEM_DEFAULT_TOKENS,
  bg: "#F3EEE4",
  accent: "#1B1814",
  buttonStyle: "fill",
  radius: 4,
};
const themes: ThemeRow[] = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Noir", system: true, tokens: NOIR },
  { id: "00000000-0000-4000-8000-000000000002", name: "Ivory", system: true, tokens: IVORY },
  { id: "00000000-0000-4000-8000-0000000000c1", name: "Shared look", system: false, tokens: IVORY },
];
const NOIR_REF = themes[0]!.id;
const SHARED_REF = themes[2]!.id;

const link = (overrides?: LinkBlock["overrides"]): LinkBlock => ({
  id: "lnk-aaaaaaaa",
  type: "link",
  visible: true,
  label: "Book",
  url: "https://example.com/book",
  ...(overrides ? { overrides } : {}),
});

describe("M3-03 colour maths", () => {
  it("WCAG contrast: black on white is 21:1, a colour on itself 1:1", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#336699", "#336699")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("the mockup's perceived brightness decides light and dark at 0.55", () => {
    expect(perceivedBrightness("#FFFFFF")).toBeCloseTo(1, 5);
    expect(isLightColor("#F3EEE4")).toBe(true);
    expect(isLightColor("#16120E")).toBe(false);
    // #C46A4F is just under the threshold: it gets the light ink.
    expect(perceivedBrightness("#C46A4F")).toBeLessThan(0.55);
    expect(inkFor("#C46A4F")).toBe(INK_ON_DARK);
    expect(inkFor("#C9A86A")).toBe(INK_ON_LIGHT);
    expect(INK_ON_LIGHT).toBe("#15110B");
    expect(INK_ON_DARK).toBe("#F7F3EC");
  });

  it("refuses anything that is not #RRGGBB instead of doing maths on NaN", () => {
    expect(() => perceivedBrightness("red")).toThrow();
    expect(() => contrastRatio("#FFF", "#000000")).toThrow();
  });
});

describe("M3-19 .. M3-24 saved-theme status", () => {
  it("the header reads the applied theme, with ' · edited' once the page overrides change something", () => {
    expect(themeStatusLabel(themes, { ref: NOIR_REF, overrides: {} })).toBe("Theme · Noir");
    expect(themeStatusLabel(themes, { ref: NOIR_REF, overrides: { accent: "#C46A4F" } })).toBe(
      "Theme · Noir · edited",
    );
    // An override equal to the theme's own value changes nothing.
    expect(themeStatusLabel(themes, { ref: NOIR_REF, overrides: { accent: NOIR.accent } })).toBe(
      "Theme · Noir",
    );
    expect(themeStatusLabel(themes, { ref: SHARED_REF, overrides: {} })).toBe(
      "Theme · Shared look",
    );
  });

  it("no theme, a foreign theme and a deleted theme all read 'Theme · Default', overrides or not (M3-05, M3-24)", () => {
    const foreign = "00000000-0000-4000-8000-0000000000b9";
    for (const ref of [null, foreign]) {
      expect(themeStatusLabel(themes, { ref, overrides: {} })).toBe("Theme · Default");
      expect(themeStatusLabel(themes, { ref, overrides: { accent: "#C46A4F" } })).toBe(
        "Theme · Default",
      );
      expect(themeTokensFor(themes, ref)).toBeNull();
      expect(isEdited(themes, { ref, overrides: { accent: "#C46A4F" } })).toBe(false);
    }
    // ...and what it resolves to is the system default plus the page's own overrides.
    expect(resolveTokens(themeTokensFor(themes, foreign), { accent: "#C46A4F" })).toEqual({
      ...SYSTEM_DEFAULT_TOKENS,
      accent: "#C46A4F",
    });
  });

  it("only the applied card has a tag: Applied, or Edited", () => {
    const applied = { ref: NOIR_REF, overrides: {} };
    expect(cardTag(themes, applied, NOIR_REF)).toBe("Applied");
    expect(cardTag(themes, applied, themes[1]!.id)).toBeNull();
    expect(cardTag(themes, { ref: NOIR_REF, overrides: { radius: 20 } }, NOIR_REF)).toBe("Edited");
    expect(
      cardTag(themes, { ref: "00000000-0000-4000-8000-0000000000b9", overrides: {} }, NOIR_REF),
    ).toBeNull();
  });

  it("names the next saved theme 'My theme N', skipping a taken name", () => {
    expect(nextThemeName(themes.slice(0, 2))).toBe("My theme 1");
    const mine = (name: string): ThemeRow => ({ id: name, name, system: false, tokens: {} });
    expect(nextThemeName([...themes.slice(0, 2), mine("A")])).toBe("My theme 2");
    expect(nextThemeName([...themes.slice(0, 2), mine("My theme 2")])).toBe("My theme 3");
    expect(nextThemeName([...themes.slice(0, 2), mine("my theme 1"), mine("My theme 2")])).toBe(
      "My theme 3",
    );
  });

  it("a rename is trimmed, one line, 1 to 40 characters", () => {
    expect(checkThemeName("  Night Market  ")).toEqual({ ok: true, name: "Night Market" });
    expect(checkThemeName("Night\nMarket")).toEqual({ ok: true, name: "Night Market" });
    expect(checkThemeName("   ")).toEqual({ ok: false, message: EMPTY_NAME_MESSAGE });
    expect(EMPTY_NAME_MESSAGE).toBe("Give the theme a name.");
    expect(checkThemeName("x".repeat(40)).ok).toBe(true);
    expect(checkThemeName("x".repeat(41)).ok).toBe(false);
  });

  it("the Free limit message uses the exact copy", () => {
    expect(savedThemeLimitMessage(3, 3)).toBe(
      "You’ve used 3 of 3 saved themes. Delete one or upgrade to Pro.",
    );
  });
});

describe("M3-17 / M3-18 override controls", () => {
  it("writes and clears the button style; an empty override set is removed from the block", () => {
    const filled = setButtonStyle(link(), "fill");
    expect(filled.overrides).toEqual({ buttonStyle: "fill" });
    expect(readButtonStyle(filled)).toBe("fill");
    expect(overrideChipLabel(filled)).toBe("Fill override");

    const cleared = setButtonStyle(filled, null);
    expect("overrides" in cleared).toBe(false);
    expect(overrideChipLabel(cleared)).toBeNull();
    // Nothing to change: the same object comes back.
    const plain = link();
    expect(setButtonStyle(plain, null)).toBe(plain);
  });

  it("Color on a link sets the button colours with auto-contrast ink; Theme default removes only those", () => {
    const dark = setColor(link(), "#c46a4f");
    expect(dark.overrides).toEqual({
      buttonBg: "#C46A4F",
      accent: "#C46A4F",
      buttonText: INK_ON_DARK,
    });
    expect(readColor(dark)).toBe("#C46A4F");

    const light = setColor(link(), "#E8E1D3");
    expect(light.overrides?.buttonText).toBe(INK_ON_LIGHT);

    const both = setButtonStyle(setRadius(dark, 0), "pill");
    expect(overrideChipLabel(both)).toBe("3 overrides");
    const withoutColor = setColor(both, null);
    expect(withoutColor.overrides).toEqual({ radius: 0, buttonStyle: "pill" });
    expect(readRadius(withoutColor)).toBe(0);
  });

  it("Color on a card sets the accent and the border", () => {
    const card = {
      id: "crd-aaaaaaaa",
      type: "card" as const,
      visible: true,
      title: "Night Market",
      caption: "",
      url: "https://example.com",
      image: null,
    };
    const coloured = setColor(card, "#8FA68A");
    expect(coloured.overrides).toEqual({ accent: "#8FA68A", border: "#8FA68A" });
    expect(overrideChipLabel(coloured)).toBe("Color override");
  });

  it("a colour that is not #RRGGBB never reaches the block", () => {
    const plain = link();
    expect(setColor(plain, "red")).toBe(plain);
    expect(setColor(plain, "#FFF")).toBe(plain);
    expect(setColor(plain, "#C46A4F;}")).toBe(plain);
  });

  it("the row chip reads '<Name> override' for one, '2 overrides' for two", () => {
    expect(overrideChipLabel(setRadius(link(), 0))).toBe("Radius override");
    expect(overrideChipLabel(setColor(link(), "#C46A4F"))).toBe("Color override");
    expect(overrideChipLabel(setRadius(setColor(link(), "#C46A4F"), 20))).toBe("2 overrides");
    expect(overrideChipLabel(setButtonStyle(link(), "shadow"))).toBe("Shadow override");
    expect(
      overrideChipLabel({ id: "hdr-aaaaaaaa", type: "header", visible: true, text: "Hi" }),
    ).toBeNull();
  });

  it("the resolver ignores any override key other than the allowed colour, style and radius keys, even in stored JSON", () => {
    expect([...BLOCK_OVERRIDE_KEYS].sort()).toEqual(
      [
        "accent",
        "border",
        "buttonBg",
        "buttonStyle",
        "buttonText",
        "radius",
        "surface",
        "text",
      ].sort(),
    );
    const page = resolveTokens(NOIR);
    const stored = {
      fontHeading: "Geist",
      fontBody: "Lora",
      bg: "#000000",
      maxWidth: 720,
      density: "airy",
      bgImage: "https://evil.example/x.png",
      customCss: "x",
      buttonBg: "#C46A4F",
      radius: 0,
    };
    const resolved = resolveBlockTokens(page, stored as never);
    expect(resolved).toEqual({ ...page, buttonBg: "#C46A4F", radius: 0 });
  });

  it("a block carrying disallowed override keys loses them on parse; an invalid allowed value fails Publish", () => {
    const base: DraftDoc = {
      version: 1,
      rev: 1,
      profile: { name: "A", bio: "", photo: null },
      theme: { ref: null, overrides: {} },
      blocks: [],
    };
    const withOverrides = (overrides: unknown): unknown => ({
      ...base,
      blocks: [{ ...link(), overrides }],
    });

    const parsed = publishDocSchema.safeParse(
      withOverrides({ fontHeading: "Geist", bg: "#000000", accent: "#C46A4F" }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const form = toPublishForm(parsed.data, null);
      expect((form.blocks[0] as LinkBlock).overrides).toEqual({ accent: "#C46A4F" });
    }
    expect(publishDocSchema.safeParse(withOverrides({ radius: -5 })).success).toBe(false);
    expect(publishDocSchema.safeParse(withOverrides({ accent: "red" })).success).toBe(false);
    expect(draftDocSchema.safeParse(withOverrides({ radius: -5 })).success).toBe(false);
  });
});

describe("M3-05 Publish error copy", () => {
  const themeError = (key: string) =>
    friendlyPublishError({
      blockId: null,
      field: `theme.overrides.${key}`,
      message: "Must be a #RRGGBB hex color",
    });

  it("names the field and how to fix it", () => {
    expect(themeError("bg").message).toBe(
      "Publish stopped: bg isn’t a valid colour. Reset it in Design.",
    );
    expect(themeError("fontHeading").message).toBe(
      "Publish stopped: fontHeading isn’t an available font. Reset it in Design.",
    );
    expect(themeError("bgImage").message).toContain("bgImage");
    expect(themeError("scale").message).toBe(
      "Publish stopped: scale isn’t valid. Reset it in Design.",
    );
  });

  it("an unknown page override key is named", () => {
    const error = friendlyPublishError({
      blockId: null,
      field: "theme.overrides",
      message: 'Unrecognized key: "customCss"',
    });
    expect(error.message).toContain("customCss");
    expect(error.message).toContain("Reset");
  });

  it("block override problems name the control, not the schema", () => {
    const radius = friendlyPublishError({
      blockId: "lnk-aaaaaaaa",
      field: "overrides.radius",
      message: "Too small: expected number to be >=0",
    });
    expect(radius.blockId).toBe("lnk-aaaaaaaa");
    expect(radius.message).toMatch(/radius/i);
    expect(radius.message).not.toMatch(/expected number/);
    expect(
      friendlyPublishError({
        blockId: "lnk-aaaaaaaa",
        field: "overrides.accent",
        message: "Must be a #RRGGBB hex color",
      }).message,
    ).toMatch(/colou?r/i);
  });

  it("leaves every other error alone", () => {
    const other = { blockId: "lnk-aaaaaaaa", field: "label", message: "Add a link label." };
    expect(friendlyPublishError(other)).toBe(other);
  });
});

describe("M3-05 background image URLs", () => {
  const origin = "http://127.0.0.1:54321";
  const owner = "00000000-0000-4000-8000-0000000000a1";
  const good = `${origin}/storage/v1/object/public/page-media/${owner}/abcdef12-aaaa.png`;

  it("accepts exactly the page-media public URL of an image path", () => {
    expect(mediaPathOf(good, origin)).toBe(`${owner}/abcdef12-aaaa.png`);
  });

  it.each([
    ["another host", "https://evil.example/x.png"],
    ["another origin with the same path", good.replace("127.0.0.1:54321", "evil.example")],
    ["another bucket", good.replace("page-media", "other")],
    ["a query string", `${good}?x=1`],
    ["a fragment", `${good}#x`],
    ["credentials", good.replace("http://", "http://u:p@")],
    ["a quote", `${good}"`],
    ["a parenthesis", good.replace(".png", ").png")],
    ["a javascript url", "javascript:alert(1)"],
    ["a data url", "data:image/png;base64,AAAA"],
    ["an encoded slash", good.replace(`${owner}/`, `${owner}%2F`)],
    [
      "a traversal",
      `${origin}/storage/v1/object/public/page-media/${owner}/../x/abcdef12-aaaa.png`,
    ],
    ["a wrong extension", good.replace(".png", ".svg")],
    ["not a url", "red;}"],
  ])("rejects %s", (_name, value) => {
    expect(mediaPathOf(value, origin)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(mediaPathOf(null, origin)).toBeNull();
    expect(mediaPathOf(42, origin)).toBeNull();
  });
});
