import type { Block, ImageRef } from "@/lib/document";

export interface Placed {
  ref: ImageRef;
  blockId: string | null;
  field: string;
}

/** The images the blocks hold (a sub-page has nothing else), with where each sits. */
export function placedBlockImages(blocks: readonly Block[]): Placed[] {
  const placed: Placed[] = [];
  for (const block of blocks) {
    if ((block.type === "card" || block.type === "image") && block.image) {
      placed.push({ ref: block.image, blockId: block.id, field: "image" });
    }
    // A link's thumbnail (M6-20): the same rules, reported under the field `icon`.
    if (block.type === "link" && block.icon?.type === "image") {
      placed.push({ ref: block.icon.image, blockId: block.id, field: "icon" });
    }
    // A book's cover (M9-20): the same rules, reported under the field `cover`.
    if (block.type === "book" && block.cover) {
      placed.push({ ref: block.cover, blockId: block.id, field: "cover" });
    }
    // An item's photo (M12-01): the same rules, reported under the field `image`.
    if (block.type === "items") {
      for (const item of block.items) {
        if (item.image) placed.push({ ref: item.image, blockId: block.id, field: "image" });
      }
    }
  }
  return placed;
}
