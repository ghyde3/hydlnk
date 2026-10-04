import { newBlockId, type Block, type DraftDoc } from "@/lib/document";

/** Every block, social icon, grid cell, FAQ question and text link id in a draft: the ids a new copy must not reuse. */
export function collectIds(
  doc: Pick<DraftDoc, "blocks"> & { banner?: { id: string } },
): Set<string> {
  // The support banner's link is counted by its own id (M9-23): a new copy must not reuse it.
  const ids = new Set<string>(doc.banner ? [doc.banner.id] : []);
  for (const block of doc.blocks) {
    ids.add(block.id);
    if (block.type === "social") for (const icon of block.icons) ids.add(icon.id);
    else if (block.type === "grid") for (const cell of block.cells) ids.add(cell.id);
    else if (block.type === "faq") for (const item of block.items) ids.add(item.id);
    else if (block.type === "book" || block.type === "apps") {
      for (const link of block.links) ids.add(link.id);
    } else if (block.type === "map") {
      ids.add(block.googleId);
      ids.add(block.appleId);
    } else if (block.type === "text") {
      for (const mark of block.marks ?? []) if (mark.type === "link") ids.add(mark.id);
    }
  }
  return ids;
}

/**
 * A copy of `block` for "Duplicate block" (M6-05): every setting is copied (text, URLs, visibility,
 * per-block overrides, the image reference), and the block, every social icon, every grid cell
 * and every link inside a text block get a fresh id, because ids are analytics keys and must be
 * unique across the page. `taken` is the set of ids already in the page; the fresh ids are added to
 * it. The original is never touched.
 *
 * The image reference keeps its path: a copy points at the same uploaded file (nothing is uploaded
 * or stored again), and the cleanup keeps the file while any block still names it.
 */
export function duplicateBlock(block: Block, taken: Set<string>): Block {
  const fresh = (): string => {
    let id = newBlockId();
    while (taken.has(id)) id = newBlockId();
    taken.add(id);
    return id;
  };
  const copy = JSON.parse(JSON.stringify(block)) as Block;
  copy.id = fresh();
  if (copy.type === "social") for (const icon of copy.icons) icon.id = fresh();
  else if (copy.type === "grid") for (const cell of copy.cells) cell.id = fresh();
  else if (copy.type === "faq") for (const item of copy.items) item.id = fresh();
  else if (copy.type === "book" || copy.type === "apps") {
    // Each store button is clicked and counted by its own id (M9-20, M9-21).
    for (const link of copy.links) link.id = fresh();
  } else if (copy.type === "map") {
    // The map's two buttons, Google Maps and Apple Maps (M9-22).
    copy.googleId = fresh();
    copy.appleId = fresh();
  } else if (copy.type === "text") {
    // The links inside the text are clicked and counted by id too (M6-28).
    for (const mark of copy.marks ?? []) if (mark.type === "link") mark.id = fresh();
  }
  return copy;
}
