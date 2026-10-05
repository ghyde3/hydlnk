import { isHttpUrl, mapTargets, type PublishDoc } from "@/lib/document";

/**
 * Where a tracked link goes (M4-22): the destination stored in the PUBLISHED document for a block,
 * social icon or grid cell id, or null. Pure: the caller loads the document, so what is proven here
 * is that the target can only ever come from it and only if it is a plain http(s) URL.
 *
 * A link block, a card and an image link carry their own `url` under the block id; an item of an items block carries its own under the item id; a social icon,
 * a grid cell and a link inside a text block carry theirs under their own item id. A discount block
 * carries its shop link, when it has one, under the block's own id (M9-19). Everything else
 * (the text, header, divider, faq, contact and embed blocks themselves, the social email icon, an item without a
 * URL) has no target.
 */
export function findLinkUrl(doc: PublishDoc, id: string): string | null {
  // The support banner's link (M9-23): the page's own top-level key, by the banner's id, from the
  // published document only (a hidden or removed banner is not in it, so its id answers nothing).
  if (doc.banner && doc.banner.id === id && doc.banner.url !== "") {
    return isHttpUrl(doc.banner.url) ? doc.banner.url : null;
  }
  for (const block of doc.blocks) {
    let url: string | undefined;
    if (block.id === id) {
      if (block.type === "link" || block.type === "card") url = block.url;
      else if (block.type === "image") url = block.url;
      // A discount code's shop link (M9-19) is clicked under the block's own id; no link, no target.
      else if (block.type === "discount" && block.url !== undefined && block.url !== "") {
        url = block.url;
      }
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
    // A store button of a book or an app block (M9-20, M9-21): by its own id; the block's id has none.
    if (url === undefined && (block.type === "book" || block.type === "apps")) {
      url = block.links.find((candidate) => candidate.id === id)?.url;
    }
    // An item of an items block (M12-01): by the item's own id; the block's id has no target. An item
    // without a link has no target either.
    if (url === undefined && block.type === "items") {
      const item = block.items.find((candidate) => candidate.id === id);
      if (item && item.url !== undefined && item.url !== "") url = item.url;
    }
    // A map's two buttons (M9-22): the targets are built here from the published name and address
    // (fixed hosts, `mapTargets`), never stored and never read from the request.
    if (url === undefined && block.type === "map") {
      if (id === block.googleId) url = mapTargets(block.name, block.address).google;
      else if (id === block.appleId) url = mapTargets(block.name, block.address).apple;
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
