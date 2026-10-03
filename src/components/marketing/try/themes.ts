import { inkFor, isLightColor } from "@/lib/themes/color";
import type { TokenOverrides, TokenSet } from "@/lib/theme";

/**
 * The try-it builder's themes: six of HYDLNK's real system themes (the rows in the reference-data
 * and more-system-themes migrations), as complete token sets. tests/unit/try-builder.test.ts reads
 * the migrations and fails if a value here drifts from the database. Everything else the builder
 * changes (accent color, fonts, button shape, background) is a page-level override on top, which is
 * how the product resolves a page too: the theme first, then the page's own choices.
 *
 * These are tenant theme values, shown inside the phone preview only. The marketing UI itself uses
 * the --hl-* tokens.
 */

export const TRY_THEME_IDS = ["sage", "paper", "ivory", "noir", "midnight", "ember"] as const;
export type TryThemeId = (typeof TRY_THEME_IDS)[number];

export interface TryTheme {
  id: TryThemeId;
  /** The theme's name in the product. */
  name: string;
  tokens: TokenSet;
}

const COMMON = {
  scale: 1,
  letterCase: "normal",
  borderWidth: 1,
  maxWidth: 480,
  align: "center",
  bgImage: null,
  overlayOpacity: 0,
  blur: 0,
} as const;

export const TRY_THEMES: readonly TryTheme[] = [
  {
    id: "sage",
    name: "Sage",
    tokens: {
      ...COMMON,
      bg: "#E8EEE3",
      surface: "#D9E3D3",
      text: "#1D2A1E",
      textMuted: "#4F5F51",
      accent: "#35563C",
      buttonBg: "#35563C",
      buttonText: "#F4F8F1",
      border: "#C3D0BC",
      fontHeading: "Lora",
      fontBody: "DM Sans",
      weightHeading: 500,
      radius: 20,
      buttonStyle: "soft",
      density: "airy",
      bgType: "solid",
    },
  },
  {
    id: "paper",
    name: "Paper",
    tokens: {
      ...COMMON,
      bg: "#FBFAF7",
      surface: "#FFFFFF",
      text: "#17181A",
      textMuted: "#5A5D63",
      accent: "#2F4B9A",
      buttonBg: "#2F4B9A",
      buttonText: "#FFFFFF",
      border: "#E4E1D9",
      fontHeading: "Bricolage Grotesque",
      fontBody: "DM Sans",
      weightHeading: 700,
      radius: 8,
      buttonStyle: "fill",
      density: "regular",
      bgType: "solid",
    },
  },
  {
    id: "ivory",
    name: "Ivory",
    tokens: {
      ...COMMON,
      bg: "#F3EEE4",
      surface: "#E6DDCD",
      text: "#1B1814",
      textMuted: "#5E564B",
      accent: "#1B1814",
      buttonBg: "#1B1814",
      buttonText: "#F7F3EC",
      border: "#CCC7BF",
      fontHeading: "Fraunces",
      fontBody: "Geist",
      weightHeading: 600,
      radius: 4,
      buttonStyle: "fill",
      density: "airy",
      bgType: "solid",
    },
  },
  {
    id: "noir",
    name: "Noir",
    tokens: {
      ...COMMON,
      bg: "#16120E",
      surface: "#221B13",
      text: "#EFE8DC",
      textMuted: "#A79E90",
      accent: "#C9A86A",
      buttonBg: "#C9A86A",
      buttonText: "#15110B",
      border: "#3A342D",
      fontHeading: "Instrument Serif",
      fontBody: "Geist",
      weightHeading: 400,
      radius: 12,
      buttonStyle: "outline",
      density: "regular",
      bgType: "solid",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    tokens: {
      ...COMMON,
      bg: "#0F1626",
      surface: "#18223A",
      text: "#E7ECF8",
      textMuted: "#9AA6C2",
      accent: "#7FA6FF",
      buttonBg: "#7FA6FF",
      buttonText: "#0B1020",
      border: "#2B3652",
      fontHeading: "Space Grotesk",
      fontBody: "Inter",
      weightHeading: 600,
      radius: 12,
      buttonStyle: "shadow",
      density: "regular",
      bgType: "gradient",
    },
  },
  {
    id: "ember",
    name: "Ember",
    tokens: {
      ...COMMON,
      bg: "#1B1412",
      surface: "#271C19",
      text: "#F3E9E2",
      textMuted: "#B8A79D",
      accent: "#E07A5F",
      buttonBg: "#E07A5F",
      buttonText: "#1B1412",
      border: "#3B2D29",
      fontHeading: "Playfair Display",
      fontBody: "Manrope",
      weightHeading: 700,
      radius: 0,
      buttonStyle: "outline",
      density: "compact",
      bgType: "solid",
    },
  },
];

export function tryTheme(id: TryThemeId): TryTheme {
  return TRY_THEMES.find((theme) => theme.id === id) ?? TRY_THEMES[0]!;
}

// Accent colors ---------------------------------------------------------------------------------

export const ACCENT_IDS = ["blue", "red", "green", "gold", "purple"] as const;
export type AccentId = (typeof ACCENT_IDS)[number];

export const ACCENT_LABELS: Record<AccentId, string> = {
  blue: "Blue",
  red: "Red",
  green: "Green",
  gold: "Gold",
  purple: "Purple",
};

/**
 * Two sets of the same five hues: deeper on a light page, brighter on a dark one, so a swatch reads
 * well on whichever theme is showing. tests/unit/try-builder.test.ts holds every swatch to 4.5:1
 * against each theme's background and 3:1 against its card color.
 */
const ACCENTS_ON_LIGHT: Record<AccentId, string> = {
  blue: "#2F4B9A",
  red: "#B3261E",
  green: "#2E6B3A",
  gold: "#8A5300",
  purple: "#6B3FA0",
};

const ACCENTS_ON_DARK: Record<AccentId, string> = {
  blue: "#7FA6FF",
  red: "#FF8A80",
  green: "#9BD67A",
  gold: "#F2B84B",
  purple: "#C4A1FF",
};

/** The swatch colors that suit a theme: the deep set on a light background, the bright on a dark. */
export function accentColors(theme: TryTheme): Record<AccentId, string> {
  return isLightColor(theme.tokens.bg) ? ACCENTS_ON_LIGHT : ACCENTS_ON_DARK;
}

// Fonts, button shape, background ----------------------------------------------------------------

export const FONT_PAIR_IDS = ["theme", "classic", "modern", "friendly"] as const;
export type FontPairId = (typeof FONT_PAIR_IDS)[number];

/** A named pairing of two allowlisted families. `theme` keeps whatever the theme itself uses. */
export const FONT_PAIRS: Record<
  Exclude<FontPairId, "theme">,
  { label: string; heading: TokenSet["fontHeading"]; body: TokenSet["fontBody"]; weight: TokenSet["weightHeading"] }
> = {
  classic: { label: "Classic", heading: "Playfair Display", body: "Manrope", weight: 700 },
  modern: { label: "Modern", heading: "Space Grotesk", body: "Inter", weight: 600 },
  friendly: { label: "Friendly", heading: "Bricolage Grotesque", body: "DM Sans", weight: 700 },
};

export const SHAPE_IDS = ["theme", "square", "rounded", "pill"] as const;
export type ShapeId = (typeof SHAPE_IDS)[number];

export const SHAPE_LABELS: Record<Exclude<ShapeId, "theme">, string> = {
  square: "Square",
  rounded: "Rounded",
  pill: "Pill",
};

export const BACKGROUND_IDS = ["theme", "flat", "gradient"] as const;
export type BackgroundId = (typeof BACKGROUND_IDS)[number];

export const BACKGROUND_LABELS: Record<Exclude<BackgroundId, "theme">, string> = {
  flat: "Flat",
  gradient: "Gradient",
};

/** What the visitor changed on top of the theme. `null` and "theme" mean "as the theme has it". */
export interface TryStyle {
  accent: AccentId | null;
  fonts: FontPairId;
  shape: ShapeId;
  background: BackgroundId;
}

export const THEME_STYLE: TryStyle = {
  accent: null,
  fonts: "theme",
  shape: "theme",
  background: "theme",
};

/** The style choices as page-level token overrides, the same layer the editor's Design screen writes. */
export function styleOverrides(theme: TryTheme, style: TryStyle): TokenOverrides {
  const overrides: TokenOverrides = {};
  if (style.accent) {
    const color = accentColors(theme)[style.accent];
    overrides.accent = color;
    overrides.buttonBg = color;
    overrides.buttonText = inkFor(color);
  }
  if (style.fonts !== "theme") {
    const pair = FONT_PAIRS[style.fonts];
    overrides.fontHeading = pair.heading;
    overrides.fontBody = pair.body;
    overrides.weightHeading = pair.weight;
  }
  if (style.shape === "square") overrides.radius = 0;
  if (style.shape === "rounded") overrides.radius = 16;
  if (style.shape === "pill") overrides.buttonStyle = "pill";
  if (style.background === "flat") overrides.bgType = "solid";
  if (style.background === "gradient") overrides.bgType = "gradient";
  return overrides;
}
