"use server";

import { getSessionUser } from "@/lib/auth/session";
import { loadVersionPreviewCore, restorePageVersionCore } from "./core";
import type { PreviewResult, RestoreResult } from "./types";

/**
 * Preview a published version (M6-49): the Server Action behind the history screen's Preview. It
 * takes a page id and a version id and nothing else; `loadVersionPreviewCore` checks the session
 * user owns the page and that the plan keeps versions, reads the stored document with the secret
 * key and returns it parsed, with the images that are gone replaced by null. It only reads: no
 * write and no cache call.
 */
export async function loadVersionPreview(
  pageId: string,
  versionId: string,
): Promise<PreviewResult> {
  const user = await getSessionUser();
  return loadVersionPreviewCore({ pageId, versionId, userId: user?.id ?? null });
}

/**
 * Restore a published version into the draft (M6-49): the Server Action behind the history
 * screen's Restore. It takes a page id and a version id and nothing else, writes `pages.draft` and
 * nothing else, and never publishes: no cache tag is expired here, so the live page does not
 * change until the owner publishes the restored draft.
 */
export async function restorePageVersion(
  pageId: string,
  versionId: string,
): Promise<RestoreResult> {
  const user = await getSessionUser();
  return restorePageVersionCore({ pageId, versionId, userId: user?.id ?? null });
}
