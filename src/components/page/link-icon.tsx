import type { ReactNode } from "react";
import {
  IMAGE_PATH_PATTERN,
  isLinkIconName,
  type ImageRef,
  type LinkBlock,
  type LinkIconName,
} from "@/lib/document";
import { mediaUrl } from "@/lib/media/url";
import { brandMarkPath } from "./brand-marks";
import { OUTLINE_GLYPHS } from "./social-icons";

/**
 * The link block's icon (M6-20): a bundled inline SVG glyph or a small square thumbnail, drawn as
 * the first child of the link's anchor. Nothing here reads a URL from the document: a glyph is
 * looked up by name in the table below (a name that is not in it draws nothing) and a thumbnail is
 * an uploaded image reference turned into a `/media/...` address by `mediaUrl`.
 *
 * The sixteen generic glyphs are 24x24 line drawings, stroke `currentColor`, so an icon takes the
 * button's text color and follows the button style and any color override. The eight brand icons
 * (instagram, tiktok, youtube, x, facebook, linkedin, github, threads) are the social row's real
 * brand marks (M9-04, ./brand-marks.ts): one filled path in `currentColor`, no stroke. Email
 * (`mail`) and Website (`globe`) are the social row's outline shapes; the other fourteen use the
 * same stroke weight and corner style. The paint is set with attributes, not CSS, so the editor's
 * icon picker draws the same glyph outside the page's stylesheet.
 */
const LINE_GLYPHS: Record<
  | "link"
  | "music"
  | "video"
  | "mic"
  | "camera"
  | "calendar"
  | "bag"
  | "ticket"
  | "heart"
  | "star"
  | "book"
  | "gift"
  | "pin"
  | "phone",
  ReactNode
> = {
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="M16 10.5l5-3v9l-5-3z" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
      <path d="M9 21h6" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.2-2h5.6L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8h14l-1 12H6z" />
      <path d="M9 8V7a3 3 0 0 1 6 0v1" />
    </>
  ),
  ticket: (
    <>
      <path d="M3.5 9V7.5A1.5 1.5 0 0 1 5 6h14a1.5 1.5 0 0 1 1.5 1.5V9a3 3 0 0 0 0 6v1.5A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5V15a3 3 0 0 0 0-6z" />
      <path d="M14 6v2" />
      <path d="M14 11v2" />
      <path d="M14 16v2" />
    </>
  ),
  heart: <path d="M12 21s-8-4.9-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.1-8 11-8 11z" />,
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />,
  book: (
    <>
      <path d="M12 6.5C10.5 5 8 4.5 4.5 4.5v13c3.5 0 6 .5 7.5 2 1.5-1.5 4-2 7.5-2v-13c-3.5 0-6 .5-7.5 2z" />
      <path d="M12 6.5v13" />
    </>
  ),
  gift: (
    <>
      <rect x="3.5" y="9" width="17" height="4" rx="1" />
      <path d="M5 13v7h14v-7" />
      <path d="M12 9v11" />
      <path d="M12 9c-1-3.5-5-4-5-1.5C7 9 12 9 12 9z" />
      <path d="M12 9c1-3.5 5-4 5-1.5C17 9 12 9 12 9z" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  phone: (
    <path d="M7.5 3.5h2.2l1.6 4-1.9 1.3a10 10 0 0 0 5.8 5.8l1.3-1.9 4 1.6v2.2a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 5.5 5.7a2 2 0 0 1 2-2.2z" />
  ),
};

/** The brand icons of the list: drawn as filled marks, from the one shared table. */
const BRAND_ICONS: ReadonlySet<string> = new Set([
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "facebook",
  "linkedin",
  "github",
  "threads",
]);

/** The line shapes of the sixteen generic names: the social row's Email and Website as `mail` and `globe`, then the rest. */
const OUTLINE: ReadonlyMap<string, ReactNode> = new Map<string, ReactNode>([
  ["mail", OUTLINE_GLYPHS.get("email")],
  ["globe", OUTLINE_GLYPHS.get("website")],
  ...Object.entries(LINE_GLYPHS),
]);

/**
 * A built-in icon: decorative (the anchor's text is its name), 20px, `currentColor`. A brand icon is
 * filled (`fill` currentColor, `stroke` none); the other sixteen keep their line style. A name that
 * is not in a table draws nothing.
 */
export function LinkGlyph({ name }: { name: LinkIconName }) {
  const mark = BRAND_ICONS.has(name) ? brandMarkPath(name) : null;
  if (mark !== null) {
    return (
      <svg
        className="pg-link-icon"
        viewBox="0 0 24 24"
        width={20}
        height={20}
        fill="currentColor"
        stroke="none"
        aria-hidden="true"
        focusable="false"
      >
        <path d={mark} />
      </svg>
    );
  }
  const glyph = OUTLINE.get(name);
  if (glyph === undefined) return null;
  return (
    <svg
      className="pg-link-icon"
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph}
    </svg>
  );
}

/**
 * A thumbnail: the owner's uploaded square image at 40px. A plain <img>: `path` is a validated
 * reference into the page-media bucket, so next/image would add nothing but a remotePatterns list.
 * No `alt` text: the link's label is its name.
 */
export function LinkThumb({ image }: { image: ImageRef }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="pg-link-thumb"
      src={mediaUrl(image.path)}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}

/** What a link's `icon` draws, or null for none: a name not on the list and a bad path draw nothing. */
export type ResolvedLinkIcon =
  { kind: "builtin"; name: LinkIconName } | { kind: "image"; image: ImageRef } | null;

export function resolveLinkIcon(icon: LinkBlock["icon"]): ResolvedLinkIcon {
  if (!icon) return null;
  if (icon.type === "builtin") {
    return isLinkIconName(icon.name) ? { kind: "builtin", name: icon.name } : null;
  }
  if (icon.type === "image" && IMAGE_PATH_PATTERN.test(icon.image.path)) {
    return { kind: "image", image: icon.image };
  }
  return null;
}
