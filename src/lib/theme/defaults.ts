import type { TokenSet } from "./tokens";

/**
 * The bottom layer of every resolution: a neutral light theme.
 * Also what a draft falls back to when its saved theme has been deleted.
 */
export const SYSTEM_DEFAULT_TOKENS: Readonly<TokenSet> = Object.freeze({
  bg: "#F7F7F5",
  surface: "#FFFFFF",
  text: "#1A1A1A",
  textMuted: "#6B6B66",
  accent: "#3B5BDB",
  buttonBg: "#1A1A1A",
  buttonText: "#FFFFFF",
  border: "#E2E2DD",
  fontHeading: "Inter",
  fontBody: "Inter",
  scale: 1,
  weightHeading: 600,
  letterCase: "normal",
  radius: 12,
  borderWidth: 1,
  buttonStyle: "fill",
  density: "regular",
  maxWidth: 480,
  align: "center",
  bgType: "solid",
  bgImage: null,
  overlayOpacity: 0,
  blur: 0,
  // Top to bottom, in the page's own surface and background colors: the gradient as it always was.
  gradientAngle: 180,
  gradientFrom: null,
  gradientTo: null,
});
