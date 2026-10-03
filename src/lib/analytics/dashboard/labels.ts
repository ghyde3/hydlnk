import { SOCIAL_PLATFORM_LABELS, type SocialPlatform } from "@/lib/document";

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

/**
 * Click ids to link names, read from the currently published document: a link by its label, a card
 * by its title, an image link by its alt text, a grid cell by its own title and a social icon by
 * its platform. Read defensively (the document is JSON from the database, not trusted to match
 * today's schema): anything unexpected is skipped, and an id that is not in the map is a link that
 * has since been removed.
 */
export function linkLabelsFromPublished(published: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  const blocks = isRecord(published) && Array.isArray(published.blocks) ? published.blocks : [];
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
