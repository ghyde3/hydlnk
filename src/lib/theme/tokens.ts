import { z } from "zod";
import { httpUrl } from "@/lib/document/url";
import { FONT_ALLOWLIST } from "./fonts";

/**
 * Tenant theme tokens (PLAN.md -> Tenant page design system).
 * These become `--t-*` CSS variables on a tenant page root. They never mix with HYDLNK's own
 * `--hl-*` UI tokens (DESIGN.md).
 */

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, { error: "Must be a #RRGGBB hex color" });
const fontFamily = z.enum(FONT_ALLOWLIST);

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
  scale: z.number().min(0.875).max(1.25),
  weightHeading: z.union([
    z.literal(400),
    z.literal(500),
    z.literal(600),
    z.literal(700),
    z.literal(800),
  ]),
  letterCase: z.enum(["none", "uppercase"]),
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
  bgImage: httpUrl.nullable(),
  overlayOpacity: z.number().min(0).max(1),
  blur: z.number().min(0).max(20),
};

/** A complete theme: every key required. Stored in `themes.tokens` and `resolvedTokens`. */
export const tokenSetSchema = z.strictObject(tokenShape);

/** Page-level overrides: any subset of the token set. */
export const tokenOverridesSchema = tokenSetSchema.partial();

/** Keys a single block may override. Anything else is rejected (schema) or ignored (resolver). */
export const BLOCK_OVERRIDE_KEYS = [
  "accent",
  "buttonBg",
  "buttonText",
  "text",
  "surface",
  "border",
  "buttonStyle",
  "radius",
] as const satisfies readonly (keyof typeof tokenShape)[];

export const blockOverridesSchema = tokenSetSchema
  .pick({
    accent: true,
    buttonBg: true,
    buttonText: true,
    text: true,
    surface: true,
    border: true,
    buttonStyle: true,
    radius: true,
  })
  .partial();

export type TokenSet = z.infer<typeof tokenSetSchema>;
export type TokenKey = keyof TokenSet;
export type TokenOverrides = z.infer<typeof tokenOverridesSchema>;
export type BlockOverrides = z.infer<typeof blockOverridesSchema>;
export type BlockOverrideKey = (typeof BLOCK_OVERRIDE_KEYS)[number];

/** Every token key, in a stable order. Derived from the schema so it cannot drift. */
export const TOKEN_KEYS = Object.keys(tokenShape) as TokenKey[];
