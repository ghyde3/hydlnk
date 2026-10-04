import { isLockShape, withUtm, type PublishDoc } from "@/lib/document";
import { findLinkUrl } from "./target";
import type { ClickLock } from "./types";

/**
 * What the click redirect knows about one link of the PUBLISHED document (M9-27, M9-29): where it
 * goes, with the page's and the link's UTM tags added, and whether it is locked. Pure: the caller
 * loads the document, so everything here comes from it and nothing from the request.
 *
 * The destination itself is `findLinkUrl`'s (it decides which ids are links at all and checks the
 * URL is plain http(s)); this only layers the two things that depend on the link's own block.
 */
export interface ResolvedLink {
  /** The destination with the UTM tags added when they apply, else exactly the published URL. */
  url: string;
  /** The link's lock; absent for an unlocked link. */
  lock?: ClickLock;
}

/**
 * Links whose destination is built by HYDLNK and not typed by the owner get no tags: the map's two
 * buttons (M9-22). Everything the owner typed (link, card, image link, grid cell, social icon, link
 * inside text, discount shop link, book and app store links, the banner link) is tagged.
 */
function isBuiltTarget(doc: PublishDoc, id: string): boolean {
  return doc.blocks.some(
    (block) => block.type === "map" && (block.googleId === id || block.appleId === id),
  );
}

export function resolveLink(doc: PublishDoc, id: string): ResolvedLink | null {
  const url = findLinkUrl(doc, id);
  if (url === null) return null;

  const block = doc.blocks.find((candidate) => candidate.id === id);
  const link = block?.type === "link" ? block : undefined;

  const tagged = isBuiltTarget(doc, id) ? url : withUtm(url, doc.utm, link?.utm);

  // A lock lives on a link block only. A stored lock that is not of one of the two valid shapes is
  // never read as "no lock": the handler answers 503 for `invalid` instead of redirecting.
  const stored: unknown = link?.lock;
  if (stored === undefined) return { url: tagged };
  return { url: tagged, lock: isLockShape(stored) ? stored : { kind: "invalid" } };
}
