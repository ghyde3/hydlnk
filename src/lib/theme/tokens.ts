import { z } from "zod";
import { isHttpUrl } from "@/lib/document/url";
import { FONT_ALLOWLIST } from "./fonts";

/**
 * Tenant theme tokens (PLAN.md -> Tenant page design system).
 * These become `--t-*` CSS variables on a tenant page root. They never mix with HYDLNK's own
 * `--hl-*` UI tokens (DESIGN.md).
 */

/**
 * A color is a hex literal and nothing else: #RGB, #RRGGBB or #RRGGBBAA (at most 9 characters).
 * No names, no functions, no `url()`: the value goes into a `--t-*` custom property verbatim.
 * The Design screen only ever writes the normalised uppercase #RRGGBB form (M3-08).
 */
const hexColor = z.string().regex(/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/, {
  error: "Must be a #RGB, #RRGGBB or #RRGGBBAA hex color",
});
const fontFamily = z.enum(FONT_ALLOWLIST);

/**
 * The eight gradient directions (M6-41), in CSS degrees: 180 is top to bottom (what the page's
 * gradient has always done), 0 bottom to top, 90 left to right, 270 right to left, and the four
 * diagonals between them. A fixed list of numbers, never a string: `45deg; background:url(...)`
 * has no way in. `gradientAngle` is rendered as `<n>deg` by the serializer and nothing else.
 */
export const GRADIENT_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const;
export type GradientAngle = (typeof GRADIENT_ANGLES)[number];
const gradientAngle = z.union([
  z.literal(0),
  z.literal(45),
  z.literal(90),
  z.literal(135),
  z.literal(180),
  z.literal(225),
  z.literal(270),
  z.literal(315),
]);

/** Bucket the page media lives in (see `src/lib/media/limits.ts`). */
const MEDIA_PUBLIC_PREFIX = "/storage/v1/object/public/page-media/";
/** `{owner uid}/{file}.{jpg|png|webp}`: the image reference path shape (`IMAGE_PATH_PATTERN`). */
const MEDIA_OBJECT_PATH = /^[0-9a-f-]{36}\/[a-z0-9-]{8,64}[.](?:jpg|png|webp)$/;
/** Quotes, parentheses and the characters that break out of a CSS string or a `<style>` element. */
const CSS_BREAKOUT = /["'()\\<>`\s]/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * True for a public URL of an image in this project's `page-media` Storage bucket and nothing
 * else: `{NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/page-media/{uid}/{file}`. https only,
 * except that the local stack (`http://127.0.0.1:54321`) may be plain http. The project URL is read
 * from the public env at parse time (inlined into the client bundle by Next); with none set,
 * nothing is accepted. Another host, another bucket, a query or fragment, quotes and parentheses
 * are all refused, so a background image can never point at a third-party server or escape its
 * CSS `url("...")`.
 */
export function isProjectMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (CSS_BREAKOUT.test(value) || !isHttpUrl(value)) return false;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  try {
    const url = new URL(value);
    const origin = new URL(base);
    if (url.origin !== origin.origin) return false;
    if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) return false;
    if (url.search !== "" || url.hash !== "") return false;
    if (!url.pathname.startsWith(MEDIA_PUBLIC_PREFIX)) return false;
    return MEDIA_OBJECT_PATH.test(url.pathname.slice(MEDIA_PUBLIC_PREFIX.length));
  } catch {
    return false;
  }
}

const mediaUrlSchema = z
  .string()
  .refine(isProjectMediaUrl, { error: "Must be an image uploaded to this project" });

const tokenShape = {
  // Color
  bg: hexColor,
  surface: hexColor,
  text: hexColor,
  textMuted: hexColor,
  accent: hexColor,
  buttonBg: hexColor,
  buttonText: hexColor,
  border: hexColor,
  // Type
  fontHeading: fontFamily,
  fontBody: fontFamily,
  scale: z.number().min(0.8).max(1.3),
  weightHeading: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]),
  letterCase: z.enum(["normal", "uppercase", "lowercase"]),
  // Shape
  radius: z.number().min(0).max(32),
  borderWidth: z.number().min(0).max(4),
  buttonStyle: z.enum(["fill", "outline", "soft", "shadow", "pill"]),
  // Space
  density: z.enum(["compact", "regular", "airy"]),
  maxWidth: z.number().min(360).max(720),
  align: z.enum(["left", "center"]),
  // Background
  bgType: z.enum(["solid", "gradient", "image"]),
  bgImage: mediaUrlSchema.nullable(),
  overlayOpacity: z.number().min(0).max(1),
  blur: z.number().min(0).max(24),
  // Gradient (M6-41). Two optional stops and a direction. A null color means "follow the page":
  // the first stop is the surface color and the last is the page background, exactly as the
  // gradient has always been drawn. The only values are a hex literal, null, or one of the eight
  // directions; the serializer writes them into `--t-gradient-*` and nothing else reaches CSS.
  gradientAngle,
  gradientFrom: hexColor.nullable(),
  gradientTo: hexColor.nullable(),
};

/** A complete theme: every key required. Stored in `themes.tokens` and `resolvedTokens`. */
export const tokenSetSchema = z.strictObject(tokenShape);

/**
 * The three tokens that joined the set in M6-41. A document or theme stored before then carries
 * the other 23 keys and none of these.
 */
export const GRADIENT_TOKEN_KEYS = ["gradientAngle", "gradientFrom", "gradientTo"] as const;

/** What a stored document without gradient tokens resolves to: today's top-to-bottom, page-colored gradient. */
const GRADIENT_DEFAULTS = { gradientAngle: 180, gradientFrom: null, gradientTo: null } as const;

/**
 * A complete token set as it may be stored. A published document written before the gradient
 * tokens existed (23 keys) still has to parse, or its page would be served as a 404, so a missing
 * gradient key takes its default first. Everything present is still checked in full: a present,
 * hostile value is refused, not defaulted. New writes always carry all 26 keys (`toPublishForm`).
 */
export const storedTokenSetSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const filled: Record<string, unknown> = { ...record };
  for (const key of GRADIENT_TOKEN_KEYS) {
    if (!(key in record)) filled[key] = GRADIENT_DEFAULTS[key];
  }
  return filled;
}, tokenSetSchema);

/** Page-level overrides: any subset of the token set. */
export const tokenOverridesSchema = tokenSetSchema.partial();

/**
 * Keys a single block may override (M3-18, M6-45): the ten of colors, button style, corner radius
 * and border thickness. Anything else (a font, the text scale, heading weight, letter case, density,
 * width, alignment, a background, gradient or overlay) is stripped by the schema and ignored by the
 * resolver, so a block never restyles type, spacing or the page background. `textMuted` and
 * `borderWidth` joined the original eight in M6-45 and take the page-level tokens' values and ranges.
 */
export const BLOCK_OVERRIDE_KEYS = [
  "accent",
  "buttonBg",
  "buttonText",
  "text",
  "textMuted",
  "surface",
  "border",
  "buttonStyle",
  "radius",
  "borderWidth",
] as const satisfies readonly (keyof typeof tokenShape)[];

export const blockOverridesSchema = tokenSetSchema
  .pick({
    accent: true,
    buttonBg: true,
    buttonText: true,
    text: true,
    textMuted: true,
    surface: true,
    border: true,
    buttonStyle: true,
    radius: true,
    borderWidth: true,
  })
  .partial();

export type TokenSet = z.infer<typeof tokenSetSchema>;
export type TokenKey = keyof TokenSet;
export type TokenOverrides = z.infer<typeof tokenOverridesSchema>;
export type BlockOverrides = z.infer<typeof blockOverridesSchema>;
export type BlockOverrideKey = (typeof BLOCK_OVERRIDE_KEYS)[number];

/** Every token key, in a stable order. Derived from the schema so it cannot drift. */
export const TOKEN_KEYS = Object.keys(tokenShape) as TokenKey[];
