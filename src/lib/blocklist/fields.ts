import type { Block, DraftDoc, PublishError } from "@/lib/document";
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

/** Every URL-valued field of a block: link, card, embed and image URLs, icon and cell URLs. */
export function urlFieldsOf(block: Block): UrlField[] {
  switch (block.type) {
    case "link":
    case "card":
    case "embed":
      return [{ blockId: block.id, value: block.url }];
    case "image":
      return block.url ? [{ blockId: block.id, value: block.url }] : [];
    case "social":
      return block.icons.flatMap((icon) =>
        "url" in icon ? [{ blockId: block.id, itemId: icon.id, value: icon.url }] : [],
      );
    case "grid":
      return block.cells.map((cell) => ({ blockId: block.id, itemId: cell.id, value: cell.url }));
    default:
      return [];
  }
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
  const errors = draft.blocks.flatMap((block) =>
    urlFieldsOf(block)
      .filter((field) => urlPointsAtHost(field.value, blocked.hosts))
      .map(toError),
  );
  if (errors.length > 0 || blocked.draft !== draft) return errors;
  return draft.blocks
    .filter((block) => blocked.blockIds.includes(block.id))
    .flatMap((block) => urlFieldsOf(block).slice(0, 1))
    .map(toError);
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
  const block = draft.blocks.find((candidate) => candidate.id === error.blockId);
  if (!block) return false;
  return urlFieldsOf(block).some(
    (field) =>
      (error.itemId === undefined || field.itemId === error.itemId) &&
      urlPointsAtHost(field.value, [host]),
  );
}
