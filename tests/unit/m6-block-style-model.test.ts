import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  blockDefaults,
  blockSchema,
  type Block,
  type BlockType,
} from "@/lib/document";
import {
  BORDER_WIDTH_OPTIONS,
  COLOR_KEYS,
  RADIUS_OPTIONS,
  STYLE_SPECS,
  activeOverrides,
  hasColorOverride,
  hasStyleControl,
  isOverridable,
  overrideChipLabel,
  overridesOf,
  readBorderWidth,
  readButtonStyle,
  readColor,
  readRadius,
  setBorderWidth,
  setButtonStyle,
  setColor,
  setRadius,
  styleSpecOf,
} from "@/lib/themes";
import { blocks } from "./fixtures/page-document";

/**
 * M6-45 and M6-46 on the editor's override model (src/lib/themes/overrides.ts): which controls each
 * block type has, which keys the Color control writes, the resets, the chip, and what a hostile or
 * half-typed value does (nothing). The controls themselves are in m6-block-style-form.test.ts.
 */

const COLOR = "#C46A4F";
const of = (type: BlockType): Block => ({ ...blocks[type] }) as Block;

const CONTROLS: Record<BlockType, string[]> = {
  link: ["buttonStyle", "color", "radius"],
  card: ["color", "radius"],
  header: ["color"],
  text: ["color"],
  image: ["radius", "borderWidth", "color"],
  embed: ["radius", "borderWidth", "color"],
  grid: ["color", "radius", "borderWidth"],
  social: ["color"],
  divider: ["color"],
  faq: ["color"],
  contact: ["color"],
  discount: ["color", "radius", "borderWidth"],
  book: ["buttonStyle", "color", "radius"],
  apps: ["color", "radius"],
  map: ["radius", "borderWidth", "color"],
};

const LABELS: Record<BlockType, string> = {
  link: "Color",
  card: "Color",
  header: "Text color",
  text: "Text color",
  image: "Border color",
  embed: "Border color",
  grid: "Color",
  social: "Icon color",
  divider: "Line color",
  faq: "Color",
  contact: "Color",
  discount: "Color",
  book: "Color",
  apps: "Color",
  map: "Border color",
};

/** The keys the Color control writes for a color, per block type. */
const WRITTEN: Record<BlockType, Record<string, string>> = {
  link: { buttonBg: COLOR, accent: COLOR, buttonText: "#F7F3EC" },
  card: { accent: COLOR, border: COLOR },
  header: { text: COLOR },
  text: { textMuted: COLOR },
  image: { border: COLOR },
  embed: { border: COLOR },
  grid: { border: COLOR, text: COLOR },
  social: { text: COLOR, border: COLOR },
  divider: { border: COLOR },
  faq: { accent: COLOR, text: COLOR, border: COLOR },
  contact: { text: COLOR, border: COLOR },
  discount: { accent: COLOR, border: COLOR },
  book: { buttonBg: COLOR, accent: COLOR, buttonText: "#F7F3EC" },
  apps: { text: COLOR, border: COLOR },
  map: { border: COLOR },
};

describe("M6-46 each block type's controls", () => {
  it("lists every type, and only the four kinds of control", () => {
    expect(Object.keys(STYLE_SPECS).sort()).toEqual([...BLOCK_TYPES].sort());
    for (const type of BLOCK_TYPES) {
      expect([...STYLE_SPECS[type].controls], type).toEqual(CONTROLS[type]);
      expect(STYLE_SPECS[type].color.label, type).toBe(LABELS[type]);
      expect(STYLE_SPECS[type].controls.includes("color"), type).toBe(true);
    }
  });

  it("no type has a font, spacing or background control, and only a link and a book have a button style", () => {
    for (const type of BLOCK_TYPES) {
      for (const control of STYLE_SPECS[type].controls) {
        expect(["buttonStyle", "color", "radius", "borderWidth"]).toContain(control);
      }
      expect(hasStyleControl(of(type), "buttonStyle"), type).toBe(
        type === "link" || type === "book",
      );
    }
  });

  it("the Color control writes the keys the block's markup reads", () => {
    for (const type of BLOCK_TYPES) {
      const next = setColor(of(type), COLOR);
      expect(overridesOf(next), type).toEqual(WRITTEN[type]);
      expect(readColor(next), type).toBe(COLOR);
      expect([...COLOR_KEYS[type]].sort(), type).toEqual(Object.keys(WRITTEN[type]).sort());
    }
  });

  it("every type is overridable; an unknown type is not", () => {
    for (const type of BLOCK_TYPES) expect(isOverridable(of(type)), type).toBe(true);
    const alien = { id: "alien-aaaa-01", type: "script", visible: true } as unknown as Block;
    expect(isOverridable(alien)).toBe(false);
    expect(styleSpecOf(alien)).toBeNull();
    expect(setColor(alien, COLOR)).toBe(alien);
    expect(overrideChipLabel(alien)).toBeNull();
    expect(activeOverrides(alien)).toEqual([]);
    expect(readColor(alien)).toBeNull();
  });

  it("the select lists are the specified ones", () => {
    expect([...RADIUS_OPTIONS]).toEqual([0, 4, 12, 20]);
    expect([...BORDER_WIDTH_OPTIONS]).toEqual([0, 1, 2]);
  });
});

describe("M6-46 setting and resetting", () => {
  it("a color is stored uppercase, and Theme default removes every key the control owns", () => {
    for (const type of BLOCK_TYPES) {
      const set = setColor(of(type), "#c46a4f");
      expect(readColor(set), type).toBe(COLOR);
      expect(hasColorOverride(set), type).toBe(true);
      const reset = setColor(set, null);
      expect(reset, type).not.toHaveProperty("overrides");
      expect(hasColorOverride(reset), type).toBe(false);
    }
  });

  it("the link's ink reads on the color: dark on a light one, light on a dark one", () => {
    expect(overridesOf(setColor(of("link"), "#F0D9A8")).buttonText).toBe("#15110B");
    expect(overridesOf(setColor(of("link"), "#1A2B3C")).buttonText).toBe("#F7F3EC");
  });

  it("when the last setting goes, the block has no overrides property at all", () => {
    for (const type of ["image", "embed", "grid"] as const) {
      let next = setRadius(of(type), 20);
      next = setBorderWidth(next, 2);
      next = setColor(next, COLOR);
      expect(next, type).toHaveProperty("overrides");
      next = setRadius(next, null);
      next = setBorderWidth(next, null);
      expect(next, type).toHaveProperty("overrides");
      next = setColor(next, null);
      expect(next, type).not.toHaveProperty("overrides");
      expect(Object.keys(next).sort(), type).toEqual(Object.keys(of(type)).sort());
    }
    const link = setButtonStyle(of("link"), "fill");
    expect(link).toHaveProperty("overrides", { buttonStyle: "fill" });
    expect(setButtonStyle(link, null)).not.toHaveProperty("overrides");
  });

  it("one control's reset leaves the others alone", () => {
    let next = setRadius(setBorderWidth(setColor(of("image"), COLOR), 2), 20);
    next = setBorderWidth(next, null);
    expect(overridesOf(next)).toEqual({ border: COLOR, radius: 20 });
    next = setColor(next, null);
    expect(overridesOf(next)).toEqual({ radius: 20 });
  });

  it("a setter returns the same object when nothing changes", () => {
    for (const type of BLOCK_TYPES) {
      const block = of(type);
      expect(setColor(block, null), type).toBe(block);
      expect(setRadius(block, null), type).toBe(block);
      expect(setBorderWidth(block, null), type).toBe(block);
      expect(setButtonStyle(block, null), type).toBe(block);
    }
    const set = setRadius(of("grid"), 12);
    expect(setRadius(set, 12)).toBe(set);
    const bordered = setBorderWidth(of("image"), 1);
    expect(setBorderWidth(bordered, 1)).toBe(bordered);
  });

  it("a half-typed or hostile color writes nothing and keeps the last valid one", () => {
    const styled = setColor(of("header"), COLOR);
    for (const bad of [
      "#12",
      "#C46A4",
      "#FFF",
      "red",
      "",
      "#C46A4F00",
      "#FFF;}</style>",
      "#GGGGGG",
      "rgb(1,2,3)",
      "url(javascript:alert(1))",
    ]) {
      expect(setColor(styled, bad), bad).toBe(styled);
      expect(setColor(of("header"), bad), bad).toEqual(of("header"));
    }
    expect(readColor(styled)).toBe(COLOR);
  });

  it("every value the model writes passes the block schema", () => {
    for (const type of BLOCK_TYPES) {
      let next = setColor(of(type), COLOR);
      if (hasStyleControl(next, "radius")) next = setRadius(next, 20);
      if (hasStyleControl(next, "borderWidth")) next = setBorderWidth(next, 2);
      if (hasStyleControl(next, "buttonStyle")) next = setButtonStyle(next, "pill");
      expect(blockSchema.safeParse(next).success, type).toBe(true);
    }
  });

  it("a fresh block of every type carries no overrides, and the model reads nothing from it", () => {
    for (const type of BLOCK_TYPES) {
      const block = blockDefaults[type]();
      expect(block, type).not.toHaveProperty("overrides");
      expect(readColor(block), type).toBeNull();
      expect(readRadius(block), type).toBeNull();
      expect(readBorderWidth(block), type).toBeNull();
      expect(readButtonStyle(block), type).toBeNull();
      expect(overrideChipLabel(block), type).toBeNull();
    }
  });

  it("a stored value the lists do not offer is still read, so the select shows it", () => {
    const stored = { ...of("image"), overrides: { radius: 8, borderWidth: 3 } } as Block;
    expect(readRadius(stored)).toBe(8);
    expect(readBorderWidth(stored)).toBe(3);
    const fractional = { ...of("grid"), overrides: { borderWidth: 1.5 } } as Block;
    expect(readBorderWidth(fractional)).toBe(1.5);
    // Not a number: nothing to show.
    const garbage = { ...of("image"), overrides: { radius: "20" } } as unknown as Block;
    expect(readRadius(garbage)).toBeNull();
  });
});

describe("M6-46 the row chip", () => {
  it("a header's text color is a 'Color override'", () => {
    expect(overrideChipLabel(setColor(of("header"), COLOR))).toBe("Color override");
  });

  it("an image with radius, thickness and border color reads '2 overrides': the border counts once", () => {
    let image = setRadius(of("image"), 20);
    expect(overrideChipLabel(image)).toBe("Radius override");
    image = setBorderWidth(image, 2);
    expect(overrideChipLabel(image)).toBe("2 overrides");
    image = setColor(image, COLOR);
    expect(overrideChipLabel(image)).toBe("2 overrides");
    expect(activeOverrides(image)).toEqual(["radius", "border"]);
  });

  it("a border thickness or a border color alone is a 'Border override', on an image and an embed", () => {
    for (const type of ["image", "embed"] as const) {
      expect(overrideChipLabel(setBorderWidth(of(type), 2)), type).toBe("Border override");
      expect(overrideChipLabel(setColor(of(type), COLOR)), type).toBe("Border override");
    }
  });

  it("the chip counts four kinds: style, color, radius and border", () => {
    // A link: style, color, radius.
    let link = setButtonStyle(of("link"), "fill");
    expect(overrideChipLabel(link)).toBe("Fill override");
    link = setColor(link, COLOR);
    expect(overrideChipLabel(link)).toBe("2 overrides");
    link = setRadius(link, 0);
    expect(overrideChipLabel(link)).toBe("3 overrides");
    expect(activeOverrides(link)).toEqual(["style", "color", "radius"]);
    // A grid: color, radius, border (the thickness): its Color control is the cells' color, not the border's.
    let grid = setColor(of("grid"), COLOR);
    expect(overrideChipLabel(grid)).toBe("Color override");
    grid = setBorderWidth(grid, 2);
    expect(overrideChipLabel(grid)).toBe("2 overrides");
    grid = setRadius(grid, 4);
    expect(overrideChipLabel(grid)).toBe("3 overrides");
    expect(activeOverrides(grid)).toEqual(["color", "radius", "border"]);
  });

  it("a social icon color and a divider line color are a 'Color override'", () => {
    expect(overrideChipLabel(setColor(of("social"), COLOR))).toBe("Color override");
    expect(overrideChipLabel(setColor(of("divider"), COLOR))).toBe("Color override");
    expect(overrideChipLabel(setColor(of("text"), COLOR))).toBe("Color override");
  });

  it("only kinds the block has a control for count: a stored radius on a header is no override", () => {
    const stored = { ...of("header"), overrides: { radius: 20, borderWidth: 2 } } as Block;
    expect(overrideChipLabel(stored)).toBeNull();
    expect(activeOverrides(stored)).toEqual([]);
    const withText = { ...of("header"), overrides: { radius: 20, text: COLOR } } as Block;
    expect(overrideChipLabel(withText)).toBe("Color override");
  });

  it("a color the control cannot show (a stored non-hex) still counts, so the chip is honest", () => {
    const stored = { ...of("header"), overrides: { text: "red" } } as Block;
    expect(readColor(stored)).toBeNull();
    expect(hasColorOverride(stored)).toBe(true);
    expect(overrideChipLabel(stored)).toBe("Color override");
  });
});
