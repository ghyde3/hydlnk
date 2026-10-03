import { z } from "zod";

/**
 * Image focus and image shapes (M6-23).
 *
 * A focus is where the picture should stay in view when a frame crops it: two numbers from 0 to 1
 * measured on the picture itself (0,0 is the top-left corner, 0.5 and 0.5 the center). It lives on
 * the image reference, `{path, width, height, focus?}`, and is kept only on card images, image
 * blocks and the share image: `toPublishForm` drops it from the profile photo and from link
 * thumbnails, which are square crops already.
 *
 * The renderer turns it into `object-position` and nothing else: `objectPositionOf` builds the
 * value from the two numbers (never from a string in the document), and returns nothing for an
 * absent or centered focus, so an old block, or one that was never positioned, keeps its markup.
 *
 * Plain functions with no server or browser imports, so the renderer, the editor and the Publish
 * gate all use the same rules.
 */

/** The shapes an image block can be cropped to, in the order of the editor's Shape select. */
export const IMAGE_SHAPES = ["square", "landscape", "wide"] as const;
export type ImageShape = (typeof IMAGE_SHAPES)[number];

/** Width : height of each shape (the frame's CSS `aspect-ratio`). */
export const IMAGE_SHAPE_RATIO: Record<ImageShape, { width: number; height: number }> = {
  square: { width: 1, height: 1 },
  landscape: { width: 4, height: 3 },
  wide: { width: 16, height: 9 },
};

/** A card's banner is 5:2, whatever the picture. */
export const CARD_BANNER_RATIO = { width: 5, height: 2 } as const;

export const IMAGE_SHAPE_MESSAGE = "Pick a shape from the list.";
export const FOCUS_MESSAGE = "Choose a focus point inside the image.";

/** Decimal places a focus keeps when it is published (and shown as a percentage: one decimal). */
const FOCUS_DECIMALS = 3;

const coordinate = z
  .number({ error: FOCUS_MESSAGE })
  .min(0, { error: FOCUS_MESSAGE })
  .max(1, { error: FOCUS_MESSAGE });

/**
 * `{x, y}`, each a finite number from 0 to 1. Any other key is stripped, and anything else (a
 * string, `null`, `NaN`, a number outside the range) fails with the Publish gate's sentence.
 */
export const focusSchema = z.object({ x: coordinate, y: coordinate }, { error: FOCUS_MESSAGE });
export type Focus = z.infer<typeof focusSchema>;

const isUnit = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * `value` as a focus, or null when it is not one (a draft written straight to the database can hold
 * anything). Total: never throws.
 */
export function focusOf(value: unknown): Focus | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return isUnit(x) && isUnit(y) ? { x, y } : null;
}

/** Rounds to three decimals, so two equal drafts give equal published forms. */
export function roundFocus(focus: Focus): Focus {
  const scale = 10 ** FOCUS_DECIMALS;
  return { x: Math.round(focus.x * scale) / scale, y: Math.round(focus.y * scale) / scale };
}

/** Whether a focus is exactly the center: it is the same as having none. */
export function isCenterFocus(focus: Focus): boolean {
  return focus.x === 0.5 && focus.y === 0.5;
}

/**
 * The focus a published document stores: valid, rounded to three decimals, and absent when it is
 * the center (or not a focus at all).
 */
export function publishFocus(value: unknown): Focus | undefined {
  const focus = focusOf(value);
  if (!focus) return undefined;
  const rounded = roundFocus(focus);
  return isCenterFocus(rounded) ? undefined : rounded;
}

/** One of the three shapes, or null: the only way a block's `shape` value is read. */
export function pickShape(value: unknown): ImageShape | null {
  return typeof value === "string" && (IMAGE_SHAPES as readonly string[]).includes(value)
    ? (value as ImageShape)
    : null;
}

/** `33.3` for 0.333: the percentage with at most one decimal. */
function percent(unit: number): number {
  return Number((unit * 100).toFixed(1));
}

/**
 * The inline style of a cropped picture: `object-position: {x*100}% {y*100}%`, built from the two
 * numbers only. `undefined` for no focus, a centered focus or anything that is not a focus, so the
 * stylesheet's own 50% 50% stands and the markup is the same as before focus existed.
 */
export function objectPositionOf(value: unknown): { objectPosition: string } | undefined {
  const focus = focusOf(value);
  if (!focus) return undefined;
  const rounded = roundFocus(focus);
  if (isCenterFocus(rounded)) return undefined;
  return { objectPosition: `${percent(rounded.x)}% ${percent(rounded.y)}%` };
}
