import "server-only";
import { imageRefSchema, type ImageRef } from "@/lib/document";
import { MESSAGES, ToolFailure } from "./errors";
import { listOwnedPages, listOwnedSubPageDocs } from "./page-access";
import type { AdminClient } from "./types";

/**
 * Images only by reference (M10-23). A tool never fetches a URL and never reads another person's
 * folder: an `imageId` is the file-name part of a path in the caller's own folder, and it is accepted
 * only when one of the caller's pages (draft or published) already holds a reference to it. The
 * width, height and focus come from that reference. `get_page` is the only way an AI learns an id.
 */

/** A file name in an upload folder: 8 to 64 letters, digits or hyphens, and jpg, png or webp. */
export const IMAGE_ID_PATTERN = /^[a-z0-9-]{8,64}[.](jpg|png|webp)$/;

export function imageIdOf(ref: { path: string }): string {
  const slash = ref.path.indexOf("/");
  return slash === -1 ? ref.path : ref.path.slice(slash + 1);
}

/** Every `{path, width, height}` in a JSON value that is a valid reference, by path. */
export function collectRefsByPath(value: unknown, into: Map<string, ImageRef> = new Map()) {
  const walk = (node: unknown, depth: number) => {
    if (depth > 12 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.path === "string" && "width" in record && "height" in record) {
      const parsed = imageRefSchema.safeParse(record);
      if (parsed.success && !into.has(parsed.data.path)) into.set(parsed.data.path, parsed.data);
    }
    for (const item of Object.values(record)) walk(item, depth + 1);
  };
  walk(value, 0);
  return into;
}

export type ImageResolver = (imageId: string) => Promise<ImageRef>;

/** Sub-page documents are read this many at a time, and at most this many in all, per call. */
const SUB_PAGE_BATCH = 100;
const SUB_PAGE_SCAN_MAX = 1000;

/**
 * A resolver for one tool call. It reads the caller's pages once, on first use, and answers every
 * later image from that read. The path is built from the TOKEN'S user: `{userId}/{imageId}`. An
 * image that no Home draft holds is looked for on the sub-pages (M12-05), a batch at a time and only
 * until it is found, so a site with hundreds of pages is not read whole for one image.
 */
export function createImageResolver(admin: AdminClient, userId: string): ImageResolver {
  let known: Promise<Map<string, ImageRef>> | null = null;
  const load = () => {
    known ??= (async () => {
      const pages = await listOwnedPages(admin, userId);
      const refs = new Map<string, ImageRef>();
      for (const page of pages) {
        collectRefsByPath(page.draft, refs);
        collectRefsByPath(page.published, refs);
      }
      return refs;
    })();
    return known;
  };
  let scanned = 0;
  let exhausted = false;
  /** Reads the next batch of sub-page documents into `refs`; false when there is nothing left. */
  const scanMore = async (refs: Map<string, ImageRef>): Promise<boolean> => {
    if (exhausted || scanned >= SUB_PAGE_SCAN_MAX) return false;
    const rows = await listOwnedSubPageDocs(admin, userId, scanned, SUB_PAGE_BATCH);
    scanned += SUB_PAGE_BATCH;
    if (rows.length < SUB_PAGE_BATCH) exhausted = true;
    for (const row of rows) {
      collectRefsByPath(row.draft, refs);
      collectRefsByPath(row.published, refs);
    }
    return rows.length > 0;
  };
  return async (imageId) => {
    if (typeof imageId !== "string" || !IMAGE_ID_PATTERN.test(imageId)) {
      throw new ToolFailure("invalid_input", MESSAGES.imageIsUrl, {
        issues: [{ path: "image", message: MESSAGES.imageIsUrl }],
      });
    }
    const refs = await load();
    const key = `${userId}/${imageId}`;
    while (!refs.has(key) && (await scanMore(refs))) {
      // keep reading batches of sub-pages until the image turns up or they run out
    }
    const ref = refs.get(key);
    if (!ref) throw new ToolFailure("image_not_found", MESSAGES.image_not_found);
    return { ...ref };
  };
}
