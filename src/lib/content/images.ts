import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_BUCKET } from "@/lib/media/limits";
import type { Database } from "@/lib/supabase/database.types";
import { failure } from "./errors";
import type { ContentFailure } from "./types";

type Admin = SupabaseClient<Database>;

/** An image a publish would store, and the field it sits in (for the issue). */
export interface ImageUse {
  path: string;
  field: string;
}

/** The images of a post: the featured image and the share image. */
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
  return uses;
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
