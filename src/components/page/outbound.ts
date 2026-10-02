import { mailtoHref, safeHref } from "@/lib/document";

/**
 * The one place the renderer gets an `href` from tenant content. Every outbound anchor spreads the
 * result of `outboundHref` (web links) or `mailtoLink` (the social email icon), so no anchor can
 * carry a raw tenant string, and none can forget `rel`.
 *
 * Milestone 2 returns the validated destination itself. Milestone 4 switches this function to the
 * click-tracking redirect (`/r/${pageId}/${id}`, the target still read from the published
 * document on the server); nothing else in the renderer changes.
 */

/** Opens no new tab; tells crawlers not to follow and the destination not to get `window.opener`. */
export const OUTBOUND_REL = "nofollow noopener";

/** Where a link lives in the page: the page and the block (or social icon, or grid cell) id. */
export interface OutboundTarget {
  pageId: string;
  /** The block id, or the icon or cell id for blocks with several links. */
  id: string;
}

export interface OutboundAttrs {
  /** `undefined` for an empty or invalid URL (a draft): the anchor renders without an `href`. */
  href: string | undefined;
  rel: typeof OUTBOUND_REL;
}

/**
 * `href` and `rel` for a web link. Wraps `safeHref` (http and https only, no credentials, no
 * control characters), so `javascript:` and `data:` URLs never reach an anchor.
 */
export function outboundHref(
  url: string | null | undefined,
  // Unused until Milestone 4 builds the /r/ URL from it; part of the signature so call sites do not change.
  target: OutboundTarget,
): OutboundAttrs {
  void target;
  return { href: safeHref(url), rel: OUTBOUND_REL };
}

/**
 * `href` and `rel` for the social email icon: `mailto:<address>` for a valid address, nothing
 * otherwise. Mailto links are not tracked, so Milestone 4 leaves this one alone.
 */
export function mailtoLink(address: string | null | undefined): OutboundAttrs {
  return { href: mailtoHref(address), rel: OUTBOUND_REL };
}
