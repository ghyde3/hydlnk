import { isHttpUrl, type PublishDoc } from "@/lib/document";

/**
 * Where a tracked link goes (M4-22): the destination stored in the PUBLISHED document for a block,
 * social icon or grid cell id, or null. Pure: the caller loads the document, so what is proven here
 * is that the target can only ever come from it and only if it is a plain http(s) URL.
 *
 * A link block, a card and an image link carry their own `url` under the block id; a social icon,
 * a grid cell and a link inside a text block carry theirs under their own item id. Everything else
 * (the text, header, divider and embed blocks themselves, the social email icon, an item without a
 * URL) has no target.
 */
export function findLinkUrl(doc: PublishDoc, id: string): string | null {
  for (const block of doc.blocks) {
    let url: string | undefined;
    if (block.id === id) {
      if (block.type === "link" || block.type === "card") url = block.url;
      else if (block.type === "image") url = block.url;
    }
    if (url === undefined && block.type === "social") {
      const icon = block.icons.find((candidate) => candidate.id === id);
      if (icon && icon.platform !== "email") url = icon.url;
    }
    if (url === undefined && block.type === "grid") {
      url = block.cells.find((candidate) => candidate.id === id)?.url;
    }
    // A link inside a text block (M6-28): only a link mark, by its own id. Bold and italic marks have none.
    if (url === undefined && block.type === "text") {
      const mark = block.marks?.find(
        (candidate) => candidate.type === "link" && candidate.id === id,
      );
      if (mark?.type === "link") url = mark.url;
    }
    if (url !== undefined) return isHttpUrl(url) ? url : null;
  }
  return null;
}

/**
 * The value of the `Location` header for a validated target. A header value must be Latin-1, so a
 * URL with other characters in it is re-serialised (`URL.href` percent-encodes them); a plain ASCII
 * URL is sent exactly as published, which is why this does not always go through `new URL` (a bare
 * origin would gain a trailing slash).
 */
export function locationFor(target: string): string {
  return /^[\x21-\x7e]+$/.test(target) ? target : new URL(target).href;
}
