"use server";

import { getSessionUser } from "@/lib/auth/session";
import { invalidatePage } from "./invalidate";
import { unpublishSiteCore, type UnpublishResult } from "./unpublish";

/**
 * Unpublish (M14-02): the Server Action behind the editor's "Unpublish" item. Takes the page id and
 * nothing else; `unpublishSiteCore` checks the session user owns the page and is not suspended, and
 * clears the published document of Home and every sub-page in one transaction.
 *
 * On success, the site's cache tag expires at once (`invalidatePage`, immediate expiry: the same
 * tag Publish expires, so the handle host, a custom domain and the sub-pages change on the very
 * next request). A refusal touches no cache.
 */
export async function unpublishSite(pageId: string): Promise<UnpublishResult> {
  const user = await getSessionUser();
  const result = await unpublishSiteCore({ pageId, userId: user?.id ?? null });
  // Tags are case-sensitive and page ids are stored lower case; the id is a GUID by now.
  if (result.ok) invalidatePage(pageId.toLowerCase());
  return result;
}
