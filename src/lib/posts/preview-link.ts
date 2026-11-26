/**
 * What a post's Preview does about the site's private share link (M16-16: "creating a link when the
 * site has none"). The Share tab only ever makes a link when the owner presses "Create link", shows
 * the address once, and keeps only a hash, so a link made earlier cannot be opened again. Preview
 * follows that: it reuses the link this tab remembers, makes one only when the site has no active
 * link at all, and otherwise stops and points at the Share tab instead of adding a link the owner
 * never chose (five links is the limit, HL006).
 */
export type PreviewChoice = "use-remembered" | "create" | "has-link" | "unknown";

export const HAS_PREVIEW_LINK_MESSAGE =
  "This site already has a private preview link, and an address is only shown when the link is made. Open the Share tab to turn one off and make a new one, or use the address you copied.";

export function choosePreviewLink(input: {
  /** The address this tab made earlier and has not lost. */
  remembered: string | null;
  /** The number of the site's active links, or null when they could not be read. */
  activeLinks: number | null;
}): PreviewChoice {
  if (input.remembered !== null) return "use-remembered";
  if (input.activeLinks === null) return "unknown";
  return input.activeLinks === 0 ? "create" : "has-link";
}
