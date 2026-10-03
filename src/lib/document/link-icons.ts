import { LIMITS } from "./limits";

/**
 * The link block's two decorations (M6-20, M6-22): the built-in icon list and the featured styles.
 *
 * Both are closed lists. A link's `icon` is either one of the 24 names below or an image the owner
 * uploaded (the same `{path, width, height}` reference every other image uses); there is no URL
 * form, so nothing in a document can make the page fetch an icon from another site. `featured` is
 * one of three words. The glyphs themselves are bundled inline SVG, drawn by
 * src/components/page/blocks/link-icon.tsx.
 */

/**
 * The 24 built-in icons, in the order of the editor's icon grid. The first eight are the social
 * platforms, `mail` and `globe` are the social row's Email and Website glyphs, and the other
 * fourteen follow the same line style.
 */
export const LINK_ICONS = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "facebook",
  "linkedin",
  "github",
  "threads",
  "link",
  "mail",
  "globe",
  "music",
  "video",
  "mic",
  "camera",
  "calendar",
  "bag",
  "ticket",
  "heart",
  "star",
  "book",
  "gift",
  "pin",
  "phone",
] as const;
export type LinkIconName = (typeof LINK_ICONS)[number];

/** What each icon is called: the editor button's `aria-label` and the preview tile's name. */
export const LINK_ICON_LABELS: Record<LinkIconName, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  github: "GitHub",
  threads: "Threads",
  link: "Link",
  mail: "Email",
  globe: "Website",
  music: "Music",
  video: "Video",
  mic: "Microphone",
  camera: "Camera",
  calendar: "Calendar",
  bag: "Shopping bag",
  ticket: "Ticket",
  heart: "Heart",
  star: "Star",
  book: "Book",
  gift: "Gift",
  pin: "Location",
  phone: "Phone",
};

const ICON_NAMES: ReadonlySet<string> = new Set(LINK_ICONS);

/**
 * Whether `value` is one of the 24 names. A lookup in a fixed set (never `in` or a property read on
 * an object), so `__proto__`, `constructor` and every other inherited key is refused too.
 */
export function isLinkIconName(value: unknown): value is LinkIconName {
  return typeof value === "string" && ICON_NAMES.has(value);
}

/** The Publish gate's sentence for a name that is not on the list. */
export const LINK_ICON_ERROR_MESSAGE = "Pick an icon from the list.";

/** The upload kind a link thumbnail uses: the profile photo's, a square 400px WebP (no new kind). */
export const LINK_THUMB_UPLOAD_KIND = "avatar" as const;

// Featured links --------------------------------------------------------------------------------

/**
 * How a featured link stands out. `bold` is the bolder style alone; `pulse` and `shine` are the
 * bold style plus a gentle motion. Absent means the link is not featured.
 */
export const LINK_FEATURED = ["bold", "pulse", "shine"] as const;
export type LinkFeatured = (typeof LINK_FEATURED)[number];

export const LINK_FEATURED_LABELS: Record<LinkFeatured, string> = {
  bold: "None",
  pulse: "Gentle pulse",
  shine: "Soft shine",
};

const FEATURED_VALUES: ReadonlySet<string> = new Set(LINK_FEATURED);

/** A lookup, as for the icon names: only the three words, whatever else a document holds. */
export function isLinkFeatured(value: unknown): value is LinkFeatured {
  return typeof value === "string" && FEATURED_VALUES.has(value);
}

/** The Publish gate's sentence for a featured value that is not one of the three. */
export const LINK_FEATURED_VALUE_MESSAGE = "Pick a featured style from the list.";

/** The Publish gate's sentence for a fourth featured link, and the editor's for a disabled switch. */
export const FEATURED_LIMIT_MESSAGE = "Feature up to 3 links. Turn one off to feature another.";

/**
 * The indexes (in page order) of the featured links past `LIMITS.featuredLinks`. Only a visible
 * link with one of the three values counts: a hidden block is dropped by Publish, and a value that
 * is not one of the three fails on its own. The Publish gate names each index it returns.
 */
export function featuredOverLimit(
  blocks: readonly { type: string; visible?: boolean; featured?: unknown }[],
): number[] {
  const over: number[] = [];
  let count = 0;
  blocks.forEach((block, index) => {
    if (block.type !== "link" || block.visible === false || !isLinkFeatured(block.featured)) return;
    count += 1;
    if (count > LIMITS.featuredLinks) over.push(index);
  });
  return over;
}
