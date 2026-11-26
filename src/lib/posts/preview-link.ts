/**
 * What a post's Preview does about the site's private share link (M16-16: "creating a link when the
 * site has none"). The Share tab only ever makes a link when the owner presses "Create link", shows
 * the address once, and keeps only a hash, so a link made earlier cannot be opened again. Preview
 * follows that: it reuses the link this tab remembers while that link is still one of the site's
 * active links, makes one only when the site has no active link at all, and otherwise stops and
 * points at the Share tab instead of adding a link the owner never chose (five links is the limit,
 * HL006). A remembered link that was turned off (in the Share tab, here or in another tab) or ran
 * out is forgotten, never opened: its address only answers 404.
 */
export type PreviewChoice = "use-remembered" | "create" | "has-link" | "unknown";

export const HAS_PREVIEW_LINK_MESSAGE =
  "This site already has a private preview link, and an address is only shown when the link is made. Open the Share tab to turn one off and make a new one, or use the address you copied.";

/** A link this tab made: its id (to check against the site's active links) and its address. */
export interface RememberedPreview {
  id: string;
  url: string;
}

export function choosePreviewLink(input: {
  /** The link this tab made earlier and has not lost. */
  remembered: RememberedPreview | null;
  /** The ids of the site's active links, or null when they could not be read. */
  activeLinkIds: readonly string[] | null;
}): PreviewChoice {
  if (input.activeLinkIds === null) return "unknown";
  if (input.remembered !== null && input.activeLinkIds.includes(input.remembered.id)) {
    return "use-remembered";
  }
  return input.activeLinkIds.length === 0 ? "create" : "has-link";
}

// The remembered link, in this tab's sessionStorage (the address is never stored on the server).

const storageKey = (siteId: string) => `hl-post-preview:${siteId}`;

/** The share link made for this site in this tab, while it has not run out. */
export function rememberedPreview(siteId: string): RememberedPreview | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(siteId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as { id?: unknown; url?: unknown; expiresAt?: unknown };
    const { id, url, expiresAt } = saved;
    if (typeof id !== "string" || typeof url !== "string" || typeof expiresAt !== "string") {
      return null;
    }
    return Date.parse(expiresAt) > Date.now() + 60_000 ? { id, url } : null;
  } catch {
    return null;
  }
}

export function rememberPreview(
  siteId: string,
  link: { id: string; url: string; expiresAt: string },
): void {
  try {
    window.sessionStorage.setItem(
      storageKey(siteId),
      JSON.stringify({ id: link.id, url: link.url, expiresAt: link.expiresAt }),
    );
  } catch {
    // Without storage the next Preview finds the site's link and points at the Share tab.
  }
}

/** Forgets the remembered link of the site; with `linkId`, only when it is that link. */
export function forgetPreview(siteId: string, linkId?: string): void {
  try {
    if (linkId !== undefined) {
      const raw = window.sessionStorage.getItem(storageKey(siteId));
      const saved = raw ? (JSON.parse(raw) as { id?: unknown }) : null;
      if (saved?.id !== linkId) return;
    }
    window.sessionStorage.removeItem(storageKey(siteId));
  } catch {
    // Nothing to forget without storage.
  }
}
