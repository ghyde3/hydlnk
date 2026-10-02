import { Fraunces, Geist, Instrument_Serif } from "next/font/google";

/*
 * Tenant theme fonts, used only inside the demo pages (DESIGN.md: no serif in the HYDLNK UI).
 * Self-hosted by next/font at build time, so a demo makes no request to Google. preload is off:
 * the demos sit below the hero and must not compete with the page's own text for bandwidth.
 */

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-demo-fraunces",
  display: "swap",
  preload: false,
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-demo-instrument",
  display: "swap",
  preload: false,
});

const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-demo-geist",
  display: "swap",
  preload: false,
});

/** Class names that define the three --font-demo-* variables; put on a demo's root. */
export const DEMO_FONT_VARIABLES = `${fraunces.variable} ${instrumentSerif.variable} ${geist.variable}`;
