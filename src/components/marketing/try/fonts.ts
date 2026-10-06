import {
  Bricolage_Grotesque,
  DM_Sans,
  Inter,
  Lora,
  Manrope,
  Playfair_Display,
  Space_Grotesk,
} from "next/font/google";
import type { FontFamily } from "@/lib/theme";
import { DEMO_FONT_VARIABLES } from "../demo/fonts";

/*
 * The fonts the try-it builder's themes and font pairs use, self-hosted by next/font at build time
 * so the preview makes no request to Google. The other three (Fraunces, Instrument Serif, Geist)
 * come from the demo pages' set. preload is off: the builder sits far below the hero, and a font
 * file is only fetched once text on screen uses it. The renderer asks for these families by their
 * Google names; try.css hands it these faces instead (see FONT_STACKS).
 */

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-try-bricolage",
  display: "swap",
  preload: false,
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-try-dm-sans",
  display: "swap",
  preload: false,
});

const lora = Lora({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-try-lora",
  display: "swap",
  preload: false,
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-try-space-grotesk",
  display: "swap",
  preload: false,
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-try-inter",
  display: "swap",
  preload: false,
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-try-playfair",
  display: "swap",
  preload: false,
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-try-manrope",
  display: "swap",
  preload: false,
});

/** Class names that define every font variable the builder uses; put them on the builder's root. */
export const TRY_FONT_VARIABLES = [
  DEMO_FONT_VARIABLES,
  bricolage.variable,
  dmSans.variable,
  lora.variable,
  spaceGrotesk.variable,
  inter.variable,
  playfair.variable,
  manrope.variable,
].join(" ");

/** Each family the builder can show -> a font-family value that resolves to its self-hosted face. */
export const FONT_STACKS: Partial<Record<FontFamily, string>> = {
  "Bricolage Grotesque": "var(--font-try-bricolage), system-ui, sans-serif",
  "DM Sans": "var(--font-try-dm-sans), system-ui, sans-serif",
  Lora: "var(--font-try-lora), Georgia, serif",
  "Space Grotesk": "var(--font-try-space-grotesk), system-ui, sans-serif",
  Inter: "var(--font-try-inter), system-ui, sans-serif",
  "Playfair Display": "var(--font-try-playfair), Georgia, serif",
  Manrope: "var(--font-try-manrope), system-ui, sans-serif",
  Fraunces: "var(--font-demo-fraunces), Georgia, serif",
  "Instrument Serif": "var(--font-demo-instrument), Georgia, serif",
  Geist: "var(--font-demo-geist), system-ui, sans-serif",
};

/** The stack for a family, or the plain system font for one the builder does not load. */
export function fontStack(family: FontFamily): string {
  return FONT_STACKS[family] ?? "system-ui, sans-serif";
}
