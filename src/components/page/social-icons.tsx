import type { ReactNode } from "react";
import type { SocialPlatform } from "@/lib/document";
import { brandMarkPath } from "./brand-marks";

/**
 * The social row's glyphs (M2-17, M9-04): a bundled inline SVG on a 24x24 box, no icon font and no
 * remote image, decorative (the anchor carries the name). The thirteen brands with a mark in
 * Simple Icons, and LinkedIn, are the real brand marks (./brand-marks.ts): one filled `<path>` in
 * `currentColor`, so an icon takes the block's `--t-text` and follows overrides. Email and Website
 * are generic and stay line drawings (stroke `currentColor`). Every lookup is a `Map` read, so a
 * platform name that is not in a table (`__proto__`, `constructor`, `<script>`) draws nothing.
 */
const OUTLINE_GLYPHS: ReadonlyMap<string, ReactNode> = new Map<string, ReactNode>([
  [
    "email",
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>,
  ],
  [
    "website",
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a13 13 0 0 1 3.5 9 13 13 0 0 1-3.5 9 13 13 0 0 1-3.5-9A13 13 0 0 1 12 3z" />
    </>,
  ],
]);

/**
 * The icon for one platform: decorative, 18px (the page's stylesheet sizes it), `currentColor`. A
 * brand mark carries the modifier class `pg-social-glyph-brand` (filled, no stroke); Email and
 * Website carry only `pg-social-glyph` (outline), so a page with only those two is unchanged.
 *
 * `size` is for the editor's platform tile (M9-04): outside a page's stylesheet the svg needs its
 * own width, height and paint, so they are written as attributes. The page never passes it.
 */
export function SocialGlyph({ platform, size }: { platform: SocialPlatform; size?: number }) {
  const mark = brandMarkPath(platform);
  if (mark !== null) {
    return (
      <svg
        className="pg-social-glyph pg-social-glyph-brand"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        width={size}
        height={size}
        fill={size === undefined ? undefined : "currentColor"}
        stroke={size === undefined ? undefined : "none"}
      >
        <path d={mark} />
      </svg>
    );
  }
  const outline = OUTLINE_GLYPHS.get(platform);
  if (outline === undefined) return null;
  const standalone = size === undefined;
  return (
    <svg
      className="pg-social-glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      fill={standalone ? undefined : "none"}
      stroke={standalone ? undefined : "currentColor"}
      strokeWidth={standalone ? undefined : 1.6}
      strokeLinecap={standalone ? undefined : "round"}
      strokeLinejoin={standalone ? undefined : "round"}
    >
      {outline}
    </svg>
  );
}

/** The two outline glyphs, for the link block's `mail` and `globe` icons (M6-20): one table, so the two rows never drift apart. */
export { OUTLINE_GLYPHS };
