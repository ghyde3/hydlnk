import { publishFocus } from "./focus";
import type { ImageRef, Share } from "./schema";

/**
 * The share card of a page (M6-32): the title, description and image of the link preview, kept
 * outside the blocks. The Zod rules sit in schema.ts (`text()` gives the one-line wording and the
 * code point limits); this module holds what is not a schema: the image size rule, the canonical
 * Publish form and the helpers the editor and the public page share. It imports schema.ts for
 * types only, so schema.ts can import the constants here without a cycle.
 */

/** Narrowest share image Publish accepts, in pixels (a link preview is drawn at 1200). */
export const SHARE_IMAGE_MIN_WIDTH = 600;
export const SHARE_IMAGE_WIDTH_MESSAGE = "Use an image at least 600 pixels wide.";

/**
 * The stored form of the share image: `{path, width, height}` and, when it is not the exact center,
 * the focus rounded to 3 decimals (M6-23's `publishFocus`: a focus of exactly 0.5 and 0.5 is left
 * out, so two equal drafts give deep-equal forms).
 */
export function publishShareImage(ref: ImageRef): ImageRef {
  const focus = publishFocus(ref.focus);
  return { path: ref.path, width: ref.width, height: ref.height, ...(focus ? { focus } : {}) };
}

/** The fields of a share card with nothing in them. */
export function isShareEmpty(share: Share | undefined): boolean {
  if (!share) return true;
  return (share.title ?? "") === "" && (share.description ?? "") === "" && !share.image;
}

/**
 * The Publish form of a draft's share card: trimmed, with empty fields omitted, and `undefined`
 * (no `share` key at all) when all three are empty. Pure and total.
 */
export function publishShare(share: Share | undefined): Share | undefined {
  if (!share) return undefined;
  const title = (share.title ?? "").trim();
  const description = (share.description ?? "").trim();
  const image = share.image ? publishShareImage(share.image) : null;
  if (title === "" && description === "" && image === null) return undefined;
  return {
    ...(title === "" ? {} : { title }),
    ...(description === "" ? {} : { description }),
    ...(image === null ? {} : { image }),
  };
}

/** What the link preview says: the share title, else the display name. Trimmed on both sides. */
export function shareTitleOf(share: Share | undefined, name: string): string {
  const title = share?.title?.trim() ?? "";
  return title === "" ? name : title;
}

/** What the link preview says under the title: the share description, else the bio. */
export function shareDescriptionOf(share: Share | undefined, bio: string): string {
  const description = share?.description?.trim() ?? "";
  return description === "" ? bio : description;
}
