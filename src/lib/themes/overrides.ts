import type { Block } from "@/lib/document";
import type { BlockOverrideKey, BlockOverrides, TokenSet } from "@/lib/theme";
import { inkFor, isHexColor } from "./color";

/**
 * Per-block overrides as the editor offers them (M3-17, M3-18, M6-46): every block type has its own
 * short list of style controls, drawn from four kinds, and nothing else. No font, spacing or
 * background control exists, and the document schema drops, and the resolver ignores, every override
 * key outside the ten of `BLOCK_OVERRIDE_KEYS`.
 *
 *   Button style  `buttonStyle`                                       link
 *   Color         one control over the color keys a block reads       every type, labeled for its job
 *   Corner radius `radius`                                            link, card, image, embed, grid
 *   Border        `borderWidth` ("Border thickness"); on an image and an embed the Color control is
 *                 "Border color" and is part of this kind                  image, embed, grid
 *
 * "Color" is one control that writes a small group of block-level keys, the ones the block's own
 * markup reads (page-renderer.css):
 *
 *   link     "Color"         buttonBg and accent = the color (the Fill background and border, the
 *                            Outline border), buttonText = dark or light ink for that color
 *                            (perceived brightness above 0.55 is light, so it gets the dark ink)
 *   card     "Color"         accent (title and arrow) and border = the color
 *   header   "Text color"    text (the heading's color)
 *   text     "Text color"    textMuted (the paragraph's color)
 *   image    "Border color"  border (drawn once the block sets a border thickness)
 *   embed    "Border color"  border (the poster, player and Spotify frame)
 *   grid     "Color"         border and text (every cell's border and title)
 *   social   "Icon color"    text and border (every icon's glyph and ring)
 *   divider  "Line color"    border (the line)
 *   faq      "Color"         accent, text and border (marker, questions, lines)
 *   contact  "Color"         text and border (name, links, card)
 *   discount "Color"         accent and border (code, Copy button, box)
 *   book     "Color"         buttonBg and accent = the color, buttonText = its ink (as a link)
 *   apps     "Color"         text and border (every badge's fill and line)
 *   map      "Border color"  border (the card's line, drawn once it has a thickness)
 *
 * Every function is pure and returns the same block object when nothing changes.
 */

export type ButtonStyle = TokenSet["buttonStyle"];

export const BUTTON_STYLES = ["fill", "outline", "soft", "shadow", "pill"] as const;

export const BUTTON_STYLE_LABELS: Record<ButtonStyle, string> = {
  fill: "Fill",
  outline: "Outline",
  soft: "Soft",
  shadow: "Shadow",
  pill: "Pill",
};

/** Corner radius choices (M3-18): the theme default, or one of these in px. */
export const RADIUS_OPTIONS = [0, 4, 12, 20] as const;

/** Border thickness choices (M6-46): the theme default, or one of these in px. */
export const BORDER_WIDTH_OPTIONS = [0, 1, 2] as const;

/** Every block type takes overrides (M6-45); the name stays for the code that was written for two. */
export type OverridableBlock = Block;

export type StyleBlockType = Block["type"];

/** One of the four kinds of control a block's style group can hold. */
export type StyleControl = "buttonStyle" | "color" | "radius" | "borderWidth";

/** The Color control of one block type. */
export interface ColorControlSpec {
  /** The control's label: "Color", "Text color", "Border color", "Icon color" or "Line color". */
  label: string;
  /** Every key the control writes (and removes on "Theme default"). */
  keys: readonly BlockOverrideKey[];
  /** The key whose value the control shows. */
  source: BlockOverrideKey;
  /** True when this is the border's color: it counts with the thickness as one "Border override". */
  border: boolean;
}

export interface StyleSpec {
  /** The controls, top to bottom. */
  controls: readonly StyleControl[];
  color: ColorControlSpec;
}

/** What each block type offers (M6-46). */
export const STYLE_SPECS: Readonly<Record<StyleBlockType, StyleSpec>> = Object.freeze({
  link: {
    controls: ["buttonStyle", "color", "radius"],
    color: {
      label: "Color",
      keys: ["buttonBg", "accent", "buttonText"],
      source: "buttonBg",
      border: false,
    },
  },
  card: {
    controls: ["color", "radius"],
    color: { label: "Color", keys: ["accent", "border"], source: "accent", border: false },
  },
  header: {
    controls: ["color"],
    color: { label: "Text color", keys: ["text"], source: "text", border: false },
  },
  text: {
    controls: ["color"],
    color: { label: "Text color", keys: ["textMuted"], source: "textMuted", border: false },
  },
  image: {
    controls: ["radius", "borderWidth", "color"],
    color: { label: "Border color", keys: ["border"], source: "border", border: true },
  },
  embed: {
    controls: ["radius", "borderWidth", "color"],
    color: { label: "Border color", keys: ["border"], source: "border", border: true },
  },
  grid: {
    controls: ["color", "radius", "borderWidth"],
    color: { label: "Color", keys: ["border", "text"], source: "border", border: false },
  },
  social: {
    controls: ["color"],
    color: { label: "Icon color", keys: ["text", "border"], source: "text", border: false },
  },
  divider: {
    controls: ["color"],
    color: { label: "Line color", keys: ["border"], source: "border", border: false },
  },
  // M9-16: the marker and focus ring (accent), the questions (text) and the lines between them (border).
  faq: {
    controls: ["color"],
    color: {
      label: "Color",
      keys: ["accent", "text", "border"],
      source: "accent",
      border: false,
    },
  },
  // M9-17: the name, the links and the border of the card.
  contact: {
    controls: ["color"],
    color: { label: "Color", keys: ["text", "border"], source: "text", border: false },
  },
  // M9-19: the code, the Copy button and the box around them (accent and border), its corners and its line.
  discount: {
    controls: ["color", "radius", "borderWidth"],
    color: { label: "Color", keys: ["accent", "border"], source: "accent", border: false },
  },
  // M9-20: the store buttons follow the page's button style, so the control is the link's.
  book: {
    controls: ["buttonStyle", "color", "radius"],
    color: {
      label: "Color",
      keys: ["buttonBg", "accent", "buttonText"],
      source: "buttonBg",
      border: false,
    },
  },
  // M9-21: a badge is filled with the text color and lettered in the page color, with a border line.
  apps: {
    controls: ["color", "radius"],
    color: { label: "Color", keys: ["text", "border"], source: "text", border: false },
  },
  // M9-22: the card has a line of its own, like an image or an embed.
  map: {
    controls: ["radius", "borderWidth", "color"],
    color: { label: "Border color", keys: ["border"], source: "border", border: true },
  },
});

/** The spec of a block type, or null for a type this version does not know (stored data). */
export function styleSpecOf(block: Block): StyleSpec | null {
  return Object.hasOwn(STYLE_SPECS, block.type) ? STYLE_SPECS[block.type] : null;
}

export function isOverridable(block: Block): block is OverridableBlock {
  return styleSpecOf(block) !== null;
}

/** Whether a block type has the given control. */
export function hasStyleControl(block: Block, control: StyleControl): boolean {
  return styleSpecOf(block)?.controls.includes(control) ?? false;
}

/** The block-level keys each type's Color control owns. */
export const COLOR_KEYS: Readonly<Record<StyleBlockType, readonly BlockOverrideKey[]>> =
  Object.freeze(
    Object.fromEntries(
      (Object.keys(STYLE_SPECS) as StyleBlockType[]).map((type) => [
        type,
        STYLE_SPECS[type].color.keys,
      ]),
    ) as Record<StyleBlockType, readonly BlockOverrideKey[]>,
  );

export function overridesOf(block: Block): BlockOverrides {
  return block.overrides ?? {};
}

/** The block with `overrides` replaced; an empty set removes the property (no `overrides: {}`). */
function withOverrides(block: Block, next: Record<string, unknown>): Block {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) cleaned[key] = value;
  }
  const { overrides: _previous, ...rest } = block;
  void _previous;
  return (
    Object.keys(cleaned).length > 0 ? { ...rest, overrides: cleaned as BlockOverrides } : rest
  ) as Block;
}

// Button style ----------------------------------------------------------------------------------

export function readButtonStyle(block: Block): ButtonStyle | null {
  const value = overridesOf(block).buttonStyle;
  return value !== undefined && (BUTTON_STYLES as readonly string[]).includes(value) ? value : null;
}

/** `null` is "Theme default": the key is removed. */
export function setButtonStyle(block: Block, style: ButtonStyle | null): Block {
  if (readButtonStyle(block) === style) return block;
  const next: Record<string, unknown> = { ...overridesOf(block) };
  if (style === null) delete next.buttonStyle;
  else next.buttonStyle = style;
  return withOverrides(block, next);
}

// Color -----------------------------------------------------------------------------------------

/** The color the block overrides, or null (not overridden, or a stored value that is not #RRGGBB). */
export function readColor(block: Block): string | null {
  const spec = styleSpecOf(block);
  if (!spec) return null;
  const value = overridesOf(block)[spec.color.source];
  return isHexColor(value) ? value : null;
}

/** Whether any of the block's color keys is set (even to a value the control cannot show). */
export function hasColorOverride(block: Block): boolean {
  const spec = styleSpecOf(block);
  if (!spec) return false;
  const overrides = overridesOf(block);
  return spec.color.keys.some((key) => overrides[key] !== undefined);
}

/** The keys a color writes for one block type (a link also gets the ink that reads on it). */
function colorValues(block: Block, color: string): Record<string, string> {
  const spec = styleSpecOf(block)!;
  const out: Record<string, string> = {};
  for (const key of spec.color.keys) out[key] = color;
  if (block.type === "link" || block.type === "book") out.buttonText = inkFor(color);
  return out;
}

/**
 * `null` is "Theme default": every color key the control owns is removed. A value that is not
 * #RRGGBB changes nothing (a half-typed or hostile string never reaches the draft).
 */
export function setColor(block: Block, hex: string | null): Block {
  const spec = styleSpecOf(block);
  if (!spec) return block;
  const next: Record<string, unknown> = { ...overridesOf(block) };
  for (const key of spec.color.keys) delete next[key];
  if (hex !== null) {
    if (!isHexColor(hex)) return block;
    Object.assign(next, colorValues(block, hex.toUpperCase()));
  } else if (!hasColorOverride(block)) {
    return block;
  }
  return withOverrides(block, next);
}

// Corner radius ---------------------------------------------------------------------------------

export function readRadius(block: Block): number | null {
  const value = overridesOf(block).radius;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `null` is "Theme default". */
export function setRadius(block: Block, radius: number | null): Block {
  if (readRadius(block) === radius) return block;
  const next: Record<string, unknown> = { ...overridesOf(block) };
  if (radius === null) delete next.radius;
  else next.radius = radius;
  return withOverrides(block, next);
}

// Border thickness ------------------------------------------------------------------------------

export function readBorderWidth(block: Block): number | null {
  const value = overridesOf(block).borderWidth;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `null` is "Theme default". */
export function setBorderWidth(block: Block, width: number | null): Block {
  if (readBorderWidth(block) === width) return block;
  const next: Record<string, unknown> = { ...overridesOf(block) };
  if (width === null) delete next.borderWidth;
  else next.borderWidth = width;
  return withOverrides(block, next);
}

// The row chip ----------------------------------------------------------------------------------

export type OverrideConcept = "style" | "color" | "radius" | "border";

/**
 * Which of the four kinds hold an override on this block, in the order style, color, radius, border.
 * Only kinds the block's type has a control for count, so a stored value no control can show (a
 * radius on a header, set through the API) never reads as an override. A border thickness and the
 * border's color count once, as "border".
 */
export function activeOverrides(block: Block): OverrideConcept[] {
  const spec = styleSpecOf(block);
  if (!spec) return [];
  const overrides = overridesOf(block);
  const has = (control: StyleControl) => spec.controls.includes(control);
  const active: OverrideConcept[] = [];
  if (has("buttonStyle") && overrides.buttonStyle !== undefined) active.push("style");
  if (has("color") && !spec.color.border && hasColorOverride(block)) active.push("color");
  if (has("radius") && overrides.radius !== undefined) active.push("radius");
  const borderSet =
    (has("borderWidth") && overrides.borderWidth !== undefined) ||
    (has("color") && spec.color.border && hasColorOverride(block));
  if (borderSet) active.push("border");
  return active;
}

/**
 * The block row's chip (M3-17, M3-18, M6-46): "<Name> override" for one override (the style's name
 * for a button style: "Fill override"; "Color override"; "Radius override"; "Border override"),
 * "2 overrides" for two and so on up to four, null for none.
 */
export function overrideChipLabel(block: Block): string | null {
  const active = activeOverrides(block);
  if (active.length === 0) return null;
  if (active.length > 1) return `${active.length} overrides`;
  const only = active[0]!;
  if (only === "color") return "Color override";
  if (only === "radius") return "Radius override";
  if (only === "border") return "Border override";
  const style = readButtonStyle(block);
  return `${style ? BUTTON_STYLE_LABELS[style] : "Style"} override`;
}
