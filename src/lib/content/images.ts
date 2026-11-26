import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { marked, type Token, type Tokens } from "marked";
import { MEDIA_BUCKET } from "@/lib/media/limits";
import { uploadPathOf } from "@/lib/media/upload-path";
import type { Database } from "@/lib/supabase/database.types";
import { failure } from "./errors";
import type { ContentFailure } from "./types";

type Admin = SupabaseClient<Database>;

/** An image a publish would store, and the field it sits in (for the issue). */
export interface ImageUse {
  path: string;
  field: string;
}

/** The images of a post: the featured image, the share image and the uploads in its body. */
export function postImages(published: unknown): ImageUse[] {
  const post = (published ?? {}) as {
    featuredImage?: { path?: unknown } | null;
    seo?: { ogImage?: { path?: unknown } | null };
  };
  const uses: ImageUse[] = [];
  if (typeof post.featuredImage?.path === "string") {
    uses.push({ path: post.featuredImage.path, field: "featuredImage" });
  }
  if (typeof post.seo?.ogImage?.path === "string") {
    uses.push({ path: post.seo.ogImage.path, field: "seo.ogImage" });
  }
  uses.push(...bodyImages(bodyOf(published)));
  return uses;
}

// The one rule for "this address is an upload": shared with the live renderer (`PostBody`).
export { uploadPathOf };

/** Most distinct images one post body may hold: Publish asks Storage about each of them. */
export const BODY_IMAGES_MAX = 50;

const FOREIGN_IMAGE_MESSAGE = "Use an image from your uploads.";

/** The address of every `image` token of the body, as written (tables, lists, quotes, links and references included). */
function imageAddresses(body: string): string[] {
  const found: string[] = [];
  marked.walkTokens(marked.lexer(body), (token: Token) => {
    if (token.type === "image") found.push((token as Tokens.Image).href);
  });
  return found;
}

const bodyOf = (draft: unknown): string => {
  const body = (draft as { body?: unknown } | null)?.body;
  return typeof body === "string" ? body : "";
};

/**
 * The images of a Markdown body that are uploads, once each, in order (field `body`). Whose upload
 * each is, and whether the file exists, is `checkOwnImages`' part. An image at any other address is
 * not listed here: `bodyImageIssue` refuses it.
 */
export function bodyImages(body: string): ImageUse[] {
  if (body === "") return [];
  const paths = new Set<string>();
  for (const address of imageAddresses(body)) {
    const path = uploadPathOf(address);
    if (path !== null) paths.add(path);
  }
  return [...paths].map((path) => ({ path, field: "body" }));
}

/**
 * Strict publish: every image in a post body must be an upload (PLAN, Content model). A remote
 * image, another bucket, a query string or any other address is refused with one message; so is a
 * body with more than `BODY_IMAGES_MAX` images. Drafts are not checked. Returns null when clean.
 */
export function bodyImageIssue(draft: unknown): ContentFailure | null {
  const body = bodyOf(draft);
  if (body === "") return null;
  const addresses = imageAddresses(body);
  if (addresses.some((address) => uploadPathOf(address) === null)) {
    return { ...failure("invalid"), issues: [{ path: "body", message: FOREIGN_IMAGE_MESSAGE }] };
  }
  if (new Set(addresses).size > BODY_IMAGES_MAX) {
    return {
      ...failure("invalid"),
      issues: [
        { path: "body", message: `A post can hold up to ${BODY_IMAGES_MAX} images. Remove some.` },
      ],
    };
  }
  return null;
}

/**
 * The publish gate's rule for images (as `checkPlaced` in the page gate): a path starts with the
 * owner's uid, so no one publishes another user's file, and the file exists, so nothing points at
 * nothing. Refuses with `invalid`; a failed storage read refuses too (closed).
 */
export async function checkOwnImages(
  admin: Admin,
  ownerId: string,
  uses: readonly ImageUse[],
  exists?: (path: string) => Promise<boolean | null>,
): Promise<ContentFailure | null> {
  const issues: Array<{ path: string; message: string }> = [];
  const own: ImageUse[] = [];
  for (const use of uses) {
    if (use.path.startsWith(`${ownerId}/`)) own.push(use);
    else
      issues.push({
        path: use.field,
        message: "That image isn’t in your uploads. Upload it again.",
      });
  }
  const bucket = admin.storage.from(MEDIA_BUCKET);
  // A missing file answers `data: false` with a 400 `error`, as in the page gate: only `data` counts.
  const present =
    exists ??
    (async (path: string) => {
      const { data } = await bucket.exists(path);
      return data === true;
    });
  for (const use of own) {
    const found = await present(use.path);
    if (found === null) return failure("error");
    if (!found) {
      issues.push({
        path: use.field,
        message: "That image is no longer available. Upload it again.",
      });
    }
  }
  return issues.length > 0 ? { ...failure("invalid"), issues } : null;
}
