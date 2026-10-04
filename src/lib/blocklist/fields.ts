import { mapTargets, type Block, type DraftDoc, type PublishError } from "@/lib/document";
import { urlPointsAtHost, type BlockedLinkError } from "./error";
import { BLOCKED_FIELD_MESSAGE } from "./messages";

/**
 * Which URL fields of a draft the link blocklist refused (M5-03), for the editor's inline errors.
 * Pure and client-safe. The database says which hosts it refused (and the ids of the blocks that
 * hold them); the fields that still hold one of those hosts are the ones that show the error, so
 * changing the URL clears it at once, before the next save has said anything.
 */

interface UrlField {
  blockId: string;
  /** The social icon or grid cell, when the URL is inside one. */
  itemId?: string;
  value: string;
}

/** Every URL-valued field of a block: link, card, embed and image URLs, icon and cell URLs, and links inside text. */
export function urlFieldsOf(block: Block): UrlField[] {
  switch (block.type) {
    case "link":
    case "card":
    case "embed":
      return [{ blockId: block.id, value: block.url }];
    case "image":
    case "discount":
      return block.url ? [{ blockId: block.id, value: block.url }] : [];
    case "social":
      return block.icons.flatMap((icon) =>
        "url" in icon ? [{ blockId: block.id, itemId: icon.id, value: icon.url }] : [],
      );
    case "grid":
      return block.cells.map((cell) => ({ blockId: block.id, itemId: cell.id, value: cell.url }));
    case "text":
      // A link inside text (M6-29): the mark's id is the item, like a social icon or a grid cell.
      return (block.marks ?? []).flatMap((mark) =>
        mark.type === "link" ? [{ blockId: block.id, itemId: mark.id, value: mark.url }] : [],
      );
    case "book":
    case "apps":
      // The store buttons (M9-20, M9-21): each entry's id is the item, like a social icon.
      return block.links.map((link) => ({ blockId: block.id, itemId: link.id, value: link.url }));
    case "map": {
      // A map stores no address; its two buttons go to the targets `/r/` builds (M9-22). They are
      // fixed hosts, so this is a defense: it keeps the check whole if the targets ever change.
      const targets = mapTargets(block.name, block.address);
      return [
        { blockId: block.id, itemId: block.googleId, value: targets.google },
        { blockId: block.id, itemId: block.appleId, value: targets.apple },
      ];
    }
    default:
      return [];
  }
}

/**
 * What the database and the Publish gate call the support banner when its link is refused (M9-23):
 * the banner is no block, so its `block_id` is this word and its `item_id` is the banner's own id.
 */
export const BANNER_BLOCK_ID = "banner";

/** The banner's address as a URL field (M9-23), or nothing when the draft has none. */
function bannerFieldsOf(draft: Pick<DraftDoc, "banner">): UrlField[] {
  // Hidden or not: the database judges a hidden banner's address too (like a hidden block's).
  const banner = draft.banner;
  if (!banner) return [];
  return [{ blockId: BANNER_BLOCK_ID, itemId: banner.id, value: banner.url }];
}

const toError = (field: UrlField): PublishError => ({
  blockId: field.blockId,
  ...(field.itemId ? { itemId: field.itemId } : {}),
  field: "url",
  message: BLOCKED_FIELD_MESSAGE,
});

/**
 * The inline errors for a refused save: every URL field that still points at a refused host. When
 * the draft is the very one that was refused and no field can be matched by host (a notation the
 * browser reads differently from the database), the blocks the database named carry the error
 * instead, on their first URL field.
 */
export function blockedFieldErrors(
  draft: DraftDoc,
  blocked: (BlockedLinkError & { draft?: DraftDoc }) | null,
): PublishError[] {
  if (!blocked) return [];
  const errors = [
    ...draft.blocks.flatMap((block) =>
      urlFieldsOf(block)
        .filter((field) => urlPointsAtHost(field.value, blocked.hosts))
        .map(toError),
    ),
    ...bannerFieldsOf(draft)
      .filter((field) => urlPointsAtHost(field.value, blocked.hosts))
      .map(toError),
  ];
  if (errors.length > 0 || blocked.draft !== draft) return errors;
  return [
    ...draft.blocks
      .filter((block) => blocked.blockIds.includes(block.id))
      .flatMap((block) => urlFieldsOf(block).slice(0, 1)),
    ...(blocked.blockIds.includes(BANNER_BLOCK_ID) ? bannerFieldsOf(draft) : []),
  ].map(toError);
}

/**
 * Does a blocklist error from a failed Publish still hold for this draft? Its field must still
 * point at the host the gate named (`reconcileErrors` keeps it only while it does).
 */
export function blockedPublishErrorHolds(
  draft: DraftDoc,
  error: PublishError & { host?: unknown },
): boolean {
  if (typeof error.host !== "string") return false;
  const host = error.host;
  if (error.blockId === BANNER_BLOCK_ID) {
    return bannerFieldsOf(draft).some((field) => urlPointsAtHost(field.value, [host]));
  }
  const block = draft.blocks.find((candidate) => candidate.id === error.blockId);
  if (!block) return false;
  return urlFieldsOf(block).some(
    (field) =>
      (error.itemId === undefined || field.itemId === error.itemId) &&
      urlPointsAtHost(field.value, [host]),
  );
}
