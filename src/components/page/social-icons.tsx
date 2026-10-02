import type { ReactNode } from "react";
import type { SocialPlatform } from "@/lib/document";

/**
 * Bundled inline SVG glyphs for the social icon row (no icon font, no remote image). One 24x24 line
 * style: stroke is `currentColor`, so an icon takes the block's `--t-text` and follows overrides.
 * The Instagram, TikTok, YouTube and Email glyphs are the Public.dc.html ones; the others follow
 * the same stroke weight and corner style.
 */
const GLYPHS: Record<SocialPlatform, ReactNode> = {
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" />
    </>
  ),
  tiktok: (
    <>
      <path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5" />
      <path d="M14 4c.5 2.5 2.5 4 5 4" />
    </>
  ),
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10 9.5v5l4.5-2.5z" />
    </>
  ),
  x: (
    <>
      <path d="M4.5 4.5l15 15" />
      <path d="M19.5 4.5l-15 15" />
    </>
  ),
  facebook: (
    <path d="M14.5 3.5H13A3.5 3.5 0 0 0 9.5 7v3H7v3.5h2.5V21H13v-7.5h2.5l.5-3.5h-3V7.4c0-.5.4-.9.9-.9h1.6z" />
  ),
  linkedin: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 10.5V16" />
      <path d="M8 7.8v.01" />
      <path d="M12 16v-5.5" />
      <path d="M12 12.8c0-1.5 1-2.3 2.3-2.3s2.2.8 2.2 2.3V16" />
    </>
  ),
  github: (
    <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
  ),
  threads: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M15.5 8.5v4a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  website: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a13 13 0 0 1 3.5 9 13 13 0 0 1-3.5 9 13 13 0 0 1-3.5-9A13 13 0 0 1 12 3z" />
    </>
  ),
};

/** The icon for one platform: decorative (the anchor carries the name), 18px, `currentColor`. */
export function SocialGlyph({ platform }: { platform: SocialPlatform }) {
  return (
    <svg className="pg-social-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {GLYPHS[platform]}
    </svg>
  );
}
