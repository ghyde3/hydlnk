import {
  SOCIAL_PLATFORM_LABELS,
  appStoreLabel,
  bookStoreLabel,
  truncateToCodePoints,
  type SocialPlatform,
} from "@/lib/document";

/** What a click row says for an id that is no longer in the published document. */
export const REMOVED_LINK = "Removed link";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The hostname of a link's URL ("example.com"), or "" when it is not an absolute URL. */
export function hostnameOf(url: unknown): string {
  const raw = text(url);
  if (raw === "") return "";
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
}

/** A name for a clickable thing: its own text, else its URL's hostname, else a plain "Link". */
function nameOf(label: unknown, url: unknown): string {
  return text(label) || hostnameOf(url) || "Link";
}

/** The first 60 characters of the text a link mark covers (code points, line breaks as spaces); "" when none. */
function linkedText(source: unknown, mark: Record<string, unknown>): string {
  if (typeof source !== "string") return "";
  const { start, end } = mark;
  if (typeof start !== "number" || typeof end !== "number") return "";
  const chars = Array.from(source).slice(
    Math.max(0, Math.trunc(start)),
    Math.max(0, Math.trunc(end)),
  );
  return chars.slice(0, 60).join("").replace(/\s+/g, " ").trim();
}

/** At most 60 characters (code points), the length every click-by-link label is held to. */
function cutTo60(value: string): string {
  const chars = Array.from(value);
  return chars.length <= 60 ? value : `${chars.slice(0, 59).join("")}\u2026`;
}

/**
 * Click ids to link names, read from the currently published document: a link by its label, a card
 * by its title, an image link by its alt text, a grid cell by its own title, a social icon by its
 * platform and a link inside text by the words it covers (M6-28). Read defensively (the document is
 * JSON from the database, not trusted to match today's schema): anything unexpected is skipped, and
 * an id that is not in the map is a link that has since been removed.
 */
export function linkLabelsFromPublished(published: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  const blocks = isRecord(published) && Array.isArray(published.blocks) ? published.blocks : [];
  // The support banner's link (M9-23): "Banner: {label}", cut to 60 characters like the others.
  if (
    isRecord(published) &&
    isRecord(published.banner) &&
    typeof published.banner.id === "string"
  ) {
    const label = text(published.banner.label);
    labels.set(published.banner.id, cutTo60(`Banner: ${label || "link"}`));
  }
  for (const block of blocks) {
    if (!isRecord(block) || typeof block.id !== "string") continue;
    switch (block.type) {
      case "link":
        labels.set(block.id, nameOf(block.label, block.url));
        break;
      case "card":
        labels.set(block.id, nameOf(block.title, block.url));
        break;
      case "image":
        if (text(block.url) !== "") labels.set(block.id, nameOf(block.alt, block.url));
        break;
      case "grid":
        for (const cell of Array.isArray(block.cells) ? block.cells : []) {
          if (isRecord(cell) && typeof cell.id === "string") {
            labels.set(cell.id, nameOf(cell.title, cell.url));
          }
        }
        break;
      case "text":
        // A link inside text (M6-28) is named by the text it is on, else by its address.
        for (const mark of Array.isArray(block.marks) ? block.marks : []) {
          if (isRecord(mark) && mark.type === "link" && typeof mark.id === "string") {
            labels.set(mark.id, nameOf(linkedText(block.text, mark), mark.url));
          }
        }
        break;
      case "discount":
        // The shop link of a discount code (M9-19) is clicked under the block's own id.
        if (text(block.url) !== "") {
          labels.set(block.id, truncateToCodePoints(`Discount ${text(block.code)}`, 60).trim());
        }
        break;
      case "contact":
        // "Save contact" (M9-18) is counted under the contact block's own id.
        labels.set(block.id, truncateToCodePoints(`Save contact: ${text(block.name)}`, 60).trim());
        break;
      case "book":
        // A store button of a book (M9-20): "{title} on Amazon", each under its own id.
        for (const link of Array.isArray(block.links) ? block.links : []) {
          if (!isRecord(link) || typeof link.id !== "string") continue;
          const store = bookStoreLabel(link.store);
          if (store === null) continue;
          labels.set(link.id, truncateToCodePoints(`${text(block.title)} on ${store}`, 60).trim());
        }
        break;
      case "apps":
        // A badge of the app store block (M9-21): "App Store" or "Google Play", each under its own id.
        for (const link of Array.isArray(block.links) ? block.links : []) {
          if (!isRecord(link) || typeof link.id !== "string") continue;
          const store = appStoreLabel(link.store);
          if (store !== null) labels.set(link.id, store);
        }
        break;
      case "map":
        // The two buttons of a map (M9-22), each under its own id.
        if (typeof block.googleId === "string") labels.set(block.googleId, "Map: Google Maps");
        if (typeof block.appleId === "string") labels.set(block.appleId, "Map: Apple Maps");
        break;
      case "social":
        for (const icon of Array.isArray(block.icons) ? block.icons : []) {
          if (isRecord(icon) && typeof icon.id === "string") {
            const platform = SOCIAL_PLATFORM_LABELS[icon.platform as SocialPlatform];
            labels.set(icon.id, platform ?? nameOf("", icon.url));
          }
        }
        break;
    }
  }
  return labels;
}
