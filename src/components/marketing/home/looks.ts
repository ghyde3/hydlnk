import type { CSSProperties } from "react";
import {
  FENNMOOR,
  NORTHFOLD,
  WRENHAVEN,
  type DemoBrand,
  type DemoFont,
  type DemoTheme,
} from "../demo/brands";
import { demoThemeVars } from "../demo/demo-page";
import type { SpecimenFace } from "./address";

/** The demo looks' heading faces, from the preloaded --font-sp-* variables (home/fonts.ts). */
const FACE_STACKS: Record<DemoFont, string> = {
  Fraunces: "var(--font-sp-fraunces), Georgia, serif",
  "Instrument Serif": "var(--font-sp-instrument), Georgia, serif",
  Geist: "var(--font-sp-geist), system-ui, sans-serif",
};

/**
 * How wide one character of an address is, as a share of the font size, per face. The handle
 * line divides the measure by (characters x this) to set the size, so a 30-letter handle still
 * fits the line at 390px. Measured on "you.hydlnk.com" and set about 5% wide; a handle of
 * unusually wide letters wraps instead of running off the page.
 */
const ADVANCE: Record<DemoFont, number> = {
  Fraunces: 0.58,
  "Instrument Serif": 0.41,
  Geist: 0.56,
};

export interface Look {
  brand: DemoBrand;
  theme: DemoTheme;
  face: SpecimenFace;
  /** True when the look's background is dark, for the focus ring and the button's edge. */
  dark: boolean;
}

function look(brand: DemoBrand, dark: boolean): Look {
  const { theme } = brand;
  return {
    brand,
    theme,
    dark,
    face: {
      look: brand.id,
      family: FACE_STACKS[theme.fontHeading],
      weight: theme.weightHeading,
      advance: ADVANCE[theme.fontHeading],
    },
  };
}

/** The look the hero opens on: Ivory. */
export const OPENING_LOOK: Look = look(FENNMOOR, false);

/** The three looks, in tab order. */
export const LOOKS: readonly Look[] = [OPENING_LOOK, look(WRENHAVEN, true), look(NORTHFOLD, true)];

/**
 * The --t-* values a demo page reads, with the heading and body faces pointed at the preloaded
 * --font-sp-* faces instead of demo/fonts.ts's lazy ones.
 */
export function phoneVars(theme: DemoTheme): CSSProperties {
  return {
    ...demoThemeVars(theme),
    "--t-font-heading": FACE_STACKS[theme.fontHeading],
    "--t-font-body": FACE_STACKS.Geist,
  } as CSSProperties;
}

/** The hero's per-look palette as --l-<id>-* variables; home.css picks the checked one. */
export function lookPaletteVars(): CSSProperties {
  return Object.fromEntries(
    LOOKS.flatMap(({ brand: { id }, theme }) => [
      [`--l-${id}-bg`, theme.bg],
      [`--l-${id}-fg`, theme.text],
      [`--l-${id}-muted`, theme.textMuted],
      [`--l-${id}-rule`, theme.border],
      [`--l-${id}-accent`, theme.accent],
    ]),
  ) as CSSProperties;
}
