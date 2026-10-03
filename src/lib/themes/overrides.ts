import type { Block, CardBlock, LinkBlock } from "@/lib/document";
import type { BlockOverrideKey, BlockOverrides, TokenSet } from "@/lib/theme";
import { inkFor, isHexColor } from "./color";

/**
 * Per-block overrides as the editor offers them (M3-17, M3-18): exactly three controls, Button
 * style (link blocks), Color and Corner radius (link and card blocks). Nothing else: no font,
 * spacing or background control exists, and the resolver ignores any other key in stored JSON.
 *
 * "Color" is one control over the color tokens a block reads, so it writes a small group of the
 * block-level keys `BLOCK_OVERRIDE_KEYS` already allows (and the renderer already follows):
 *
 *   link  buttonBg and accent = the color (the Fill background and border, the Outline border),
 *         buttonText = dark or light ink for that color (perceived brightness above 0.55 is
 *         light, so it gets the dark ink)
 *   card  accent (title and arrow) and border = the color
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

export type OverridableBlock = LinkBlock | CardBlock;

export function isOverridable(block: Block): block is OverridableBlock {
  return block.type === "link" || block.type === "card";
}

/** The block-level keys each type's Color control owns. */
export const COLOR_KEYS: Record<OverridableBlock["type"], readonly BlockOverrideKey[]> = {
  link: ["buttonBg", "accent", "buttonText"],
  card: ["accent", "border"],
};

/** The key whose value the Color control shows. */
const COLOR_SOURCE: Record<OverridableBlock["type"], BlockOverrideKey> = {
  link: "buttonBg",
  card: "accent",
};

export function overridesOf(block: OverridableBlock): BlockOverrides {
  return block.overrides ?? {};
}

/** The block with `overrides` replaced; an empty set removes the property (no `overrides: {}`). */
function withOverrides(block: OverridableBlock, next: Record<string, unknown>): OverridableBlock {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) cleaned[key] = value;
  }
  const { overrides: _previous, ...rest } = block;
  void _previous;
  return (
    Object.keys(cleaned).length > 0 ? { ...rest, overrides: cleaned as BlockOverrides } : rest
  ) as OverridableBlock;
}

// Button style ----------------------------------------------------------------------------------

export function readButtonStyle(block: OverridableBlock): ButtonStyle | null {
  const value = overridesOf(block).buttonStyle;
  return value !== undefined && (BUTTON_STYLES as readonly string[]).includes(value) ? value : null;
}

/** `null` is "Theme default": the key is removed. */
export function setButtonStyle(block: OverridableBlock, style: ButtonStyle | null) {
  if (readButtonStyle(block) === style) return block;
  const next: Record<string, unknown> = { ...overridesOf(block) };
  if (style === null) delete next.buttonStyle;
  else next.buttonStyle = style;
  return withOverrides(block, next);
}

// Color -----------------------------------------------------------------------------------------

/** The color the block overrides, or null (not overridden, or a stored value that is not #RRGGBB). */
export function readColor(block: OverridableBlock): string | null {
  const value = overridesOf(block)[COLOR_SOURCE[block.type]];
  return isHexColor(value) ? value : null;
}

/** Whether any of the block's color keys is set (even to a value the control cannot show). */
export function hasColorOverride(block: OverridableBlock): boolean {
  const overrides = overridesOf(block);
  return COLOR_KEYS[block.type].some((key) => overrides[key] !== undefined);
}

/** `null` is "Theme default": every color key the control owns is removed. */
export function setColor(block: OverridableBlock, hex: string | null) {
  const next: Record<string, unknown> = { ...overridesOf(block) };
  for (const key of COLOR_KEYS[block.type]) delete next[key];
  if (hex !== null) {
    if (!isHexColor(hex)) return block;
    const color = hex.toUpperCase();
    if (block.type === "link") {
      next.buttonBg = color;
      next.accent = color;
      next.buttonText = inkFor(color);
    } else {
      next.accent = color;
      next.border = color;
    }
  } else if (!hasColorOverride(block)) {
    return block;
  }
  return withOverrides(block, next);
}

// Corner radius ---------------------------------------------------------------------------------

export function readRadius(block: OverridableBlock): number | null {
  const value = overridesOf(block).radius;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `null` is "Theme default". */
export function setRadius(block: OverridableBlock, radius: number | null) {
  if (readRadius(block) === radius) return block;
  const next: Record<string, unknown> = { ...overridesOf(block) };
  if (radius === null) delete next.radius;
  else next.radius = radius;
  return withOverrides(block, next);
}

// The row chip ----------------------------------------------------------------------------------

export type OverrideConcept = "style" | "color" | "radius";

/** Which of the three controls hold an override on this block. */
export function activeOverrides(block: Block): OverrideConcept[] {
  if (!isOverridable(block)) return [];
  const active: OverrideConcept[] = [];
  if (overridesOf(block).buttonStyle !== undefined) active.push("style");
  if (hasColorOverride(block)) active.push("color");
  if (overridesOf(block).radius !== undefined) active.push("radius");
  return active;
}

/**
 * The block row's chip (M3-17, M3-18): "<Name> override" for one override (the style's name for a
 * button style: "Fill override"; "Color override"; "Radius override"), "2 overrides" for two,
 * "3 overrides" for three, null for none.
 */
export function overrideChipLabel(block: Block): string | null {
  if (!isOverridable(block)) return null;
  const active = activeOverrides(block);
  if (active.length === 0) return null;
  if (active.length > 1) return `${active.length} overrides`;
  const only = active[0]!;
  if (only === "color") return "Color override";
  if (only === "radius") return "Radius override";
  const style = readButtonStyle(block);
  return `${style ? BUTTON_STYLE_LABELS[style] : "Style"} override`;
}
