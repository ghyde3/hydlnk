import { mailtoHref, safeHref } from "@/lib/document";

/**
 * The one place the renderer gets an `href` from tenant content. Every outbound anchor spreads the
 * result of `outboundHref` (web links) or `mailtoLink` (the social email icon), so no anchor can
 * carry a raw tenant string, and none can forget `rel`.
 *
 * A web link's `href` is the click-tracking redirect, `/r/<pageId>/<id>` (M4-22): relative, so it
 * goes to whichever host served the page, and the destination is never in the markup: the server
 * reads it from the page's published document by id. The destination is still validated here
 * (`safeHref`), so a link with no usable URL renders without an `href` at all, as before.
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
 * `href` and `rel` for a web link: `/r/<pageId>/<id>` when the destination passes `safeHref` (http
 * and https only, no credentials, no control characters), nothing otherwise, so `javascript:` and
 * `data:` URLs never produce an anchor that goes anywhere. Both path segments are encoded, so an
 * id can never add a segment or a query.
 */
export function outboundHref(
  url: string | null | undefined,
  target: OutboundTarget,
): OutboundAttrs {
  if (safeHref(url) === undefined) return { href: undefined, rel: OUTBOUND_REL };
  return {
    href: `/r/${encodeURIComponent(target.pageId)}/${encodeURIComponent(target.id)}`,
    rel: OUTBOUND_REL,
  };
}

/**
 * `href` and `rel` for the social email icon: `mailto:<address>` for a valid address, nothing
 * otherwise. Mailto links are not tracked: this one stays a plain `mailto:`.
 */
export function mailtoLink(address: string | null | undefined): OutboundAttrs {
  return { href: mailtoHref(address), rel: OUTBOUND_REL };
}
