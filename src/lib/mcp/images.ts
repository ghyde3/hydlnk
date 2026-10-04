import "server-only";
import { imageRefSchema, type ImageRef } from "@/lib/document";
import { MESSAGES, ToolFailure } from "./errors";
import { listOwnedPages } from "./page-access";
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

/**
 * A resolver for one tool call. It reads the caller's pages once, on first use, and answers every
 * later image from that read. The path is built from the TOKEN'S user: `{userId}/{imageId}`.
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
  return async (imageId) => {
    if (typeof imageId !== "string" || !IMAGE_ID_PATTERN.test(imageId)) {
      throw new ToolFailure("invalid_input", MESSAGES.imageIsUrl, {
        issues: [{ path: "image", message: MESSAGES.imageIsUrl }],
      });
    }
    const ref = (await load()).get(`${userId}/${imageId}`);
    if (!ref) throw new ToolFailure("image_not_found", MESSAGES.image_not_found);
    return { ...ref };
  };
}
