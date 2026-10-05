import { Fraunces, Geist, Instrument_Serif } from "next/font/google";

/*
 * The heading faces of the three demo looks (Ivory, Noir, Smoke), self-hosted by next/font at build
 * time (no request to Google). The hero sets the visitor's address in them and its phone page uses
 * them, so they are preloaded and arrive with the first paint instead of swapping in late
 * (demo/fonts.ts declares the same faces without preload for the demos on other pages). HYDLNK's own
 * text stays in Public Sans and Geist Mono from the root layout.
 */

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-sp-fraunces",
  display: "swap",
});

const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-sp-instrument",
  display: "swap",
});

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sp-geist",
  display: "swap",
});

/** Class names that define the three --font-sp-* variables; put them on a section that uses them. */
export const LOOK_FONT_VARIABLES = `${fraunces.variable} ${instrument.variable} ${geist.variable}`;
