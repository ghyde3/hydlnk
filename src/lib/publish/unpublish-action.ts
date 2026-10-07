"use server";

import { getSessionUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { invalidatePage } from "./invalidate";
import { UNPUBLISH_RATE_LIMIT, UNPUBLISH_RATE_WINDOW_SECONDS, unpublishRateKey } from "./limits";
import { unpublishSiteCore, type UnpublishResult } from "./unpublish";

/**
 * Unpublish (M14-02): the Server Action behind the editor's "Unpublish" item. Takes the page id and
 * nothing else; `unpublishSiteCore` checks the session user owns the page and is not suspended, and
 * clears the published document of Home and every sub-page in one transaction.
 *
 * On success, the site's cache tag expires at once (`invalidatePage`, immediate expiry: the same
 * tag Publish expires, so the handle host, a custom domain and the sub-pages change on the very
 * next request). A refusal touches no cache. Capped like Publish (60 an hour per account): every
 * success expires the site's cache, so a loop would only make the platform re-render the site.
 */
export async function unpublishSite(pageId: string): Promise<UnpublishResult> {
  const user = await getSessionUser();
  if (user) {
    const limit = await rateLimit(
      unpublishRateKey(user.id),
      UNPUBLISH_RATE_LIMIT,
      UNPUBLISH_RATE_WINDOW_SECONDS,
    );
    if (!limit.allowed) return { ok: false, reason: "rate_limited" };
  }
  const result = await unpublishSiteCore({ pageId, userId: user?.id ?? null });
  // Tags are case-sensitive and page ids are stored lower case; the id is a GUID by now.
  if (result.ok) invalidatePage(pageId.toLowerCase());
  return result;
}
