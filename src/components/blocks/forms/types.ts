import type { Block, ImageRef, PublishError } from "@/lib/document";

/**
 * What every block form receives. `block` is the raw draft block (never a parsed copy: the
 * inputs show exactly what was typed), `onChange` takes the whole next block, `onImage` sets only the image, and `errors` are the
 * Publish gate's messages, from which a form picks the ones for its own block and fields.
 */
export interface BlockFormProps {
  block: Block;
  onChange: (next: Block) => void;
  /**
   * An upload finished (or the image was removed): set the block's image. Unlike `onChange` it is
   * applied to the block as it is by then, so text typed while the file was uploading is kept.
   */
  onImage: (image: ImageRef | null) => void;
  errors: PublishError[];
}

/** The messages the Publish gate gave one field of this block (or of one icon or cell). */
export function fieldError(
  errors: readonly PublishError[],
  blockId: string,
  field: string,
  itemId?: string,
): string | null {
  const hit = errors.find(
    (error) =>
      error.blockId === blockId &&
      error.field === field &&
      (itemId === undefined ? error.itemId === undefined : error.itemId === itemId),
  );
  return hit ? hit.message : null;
}

/** Whether the Publish gate flagged anything inside one icon or cell. */
export function itemHasError(
  errors: readonly PublishError[],
  blockId: string,
  itemId: string,
): boolean {
  return errors.some((error) => error.blockId === blockId && error.itemId === itemId);
}

/**
 * The Publish gate's message for a block's image: `image` for a missing, foreign or vanished upload,
 * `image.path` for a value that is not a stored image reference at all.
 */
export function imageError(errors: readonly PublishError[], blockId: string): string | null {
  const hit = errors.find(
    (error) =>
      error.blockId === blockId &&
      error.itemId === undefined &&
      (error.field === "image" || error.field.startsWith("image.")),
  );
  return hit ? hit.message : null;
}
