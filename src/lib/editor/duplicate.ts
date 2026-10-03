import { newBlockId, type Block, type DraftDoc } from "@/lib/document";

/** Every block, social icon and grid cell id in a draft: the ids a new copy must not reuse. */
export function collectIds(doc: Pick<DraftDoc, "blocks">): Set<string> {
  const ids = new Set<string>();
  for (const block of doc.blocks) {
    ids.add(block.id);
    if (block.type === "social") for (const icon of block.icons) ids.add(icon.id);
    else if (block.type === "grid") for (const cell of block.cells) ids.add(cell.id);
  }
  return ids;
}

/**
 * A copy of `block` for "Duplicate block" (M6-05): every setting is copied (text, URLs, visibility,
 * per-block overrides, the image reference), and the block, every social icon and every grid cell
 * get a fresh id, because ids are analytics keys and must be unique across the page. `taken` is the
 * set of ids already in the page; the fresh ids are added to it. The original is never touched.
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
  return copy;
}
