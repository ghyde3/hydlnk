import { blockIdsOf, freshenBlockIds, newBlockId, type Block, type DraftDoc } from "@/lib/document";

/** Every block, social icon, grid cell, FAQ question and text link id in a draft: the ids a new copy must not reuse. */
export function collectIds(
  doc: Pick<DraftDoc, "blocks"> & { banner?: { id: string } },
): Set<string> {
  // The support banner's link is counted by its own id (M9-23): a new copy must not reuse it.
  const ids = new Set<string>(doc.banner ? [doc.banner.id] : []);
  for (const id of blockIdsOf(doc.blocks)) ids.add(id);
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
  // One shared helper (with Duplicate page, M12-08) covers every nested id, items blocks included.
  const copy = freshenBlockIds(JSON.parse(JSON.stringify(block)) as Block, fresh);
  return copy;
}
