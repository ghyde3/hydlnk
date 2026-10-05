"use server";

import { updateTag } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { cleanupMediaQuietly } from "@/lib/media/cleanup-admin";
import { rateLimit } from "@/lib/rate-limit";
import { publishPageCore, type PublishResult } from "./core";
import { PUBLISH_RATE_LIMIT, PUBLISH_RATE_WINDOW_SECONDS, publishRateKey } from "./limits";
import { pageTag } from "./tags";

/**
 * Publish (M2-23): the Server Action behind the editor's Publish button. Takes the page id and
 * nothing else; the draft is read from Postgres by `publishPageCore`, which checks the session
 * user owns the page, validates the draft, freezes the resolved tokens and writes
 * `pages.published` with the secret key.
 *
 * On success only, `updateTag` expires the page's cache tag inside this action, so the next
 * request to the public page (and its OG image) is rendered from the new document, with no wait.
 * The tag covers the whole site (M11-05): the sub-pages' public reads and the site index carry the
 * same `page:<id>` tag, so one `updateTag` refreshes Home and every sub-page.
 * Rate limit (M11-12): 60 publishes an hour per account; past it the answer is
 * `{ok: false, errors: [], reason: "rate_limited"}` before anything is read or written.
 * A failed publish returns the errors and touches no cache: the live page stays as it was. Any
 * other failure reads `{ok: false, errors: []}` with a `reason`.
 */
export async function publishPage(pageId: string): Promise<PublishResult> {
  const user = await getSessionUser();
  if (user) {
    const limit = await rateLimit(
      publishRateKey(user.id),
      PUBLISH_RATE_LIMIT,
      PUBLISH_RATE_WINDOW_SECONDS,
    );
    if (!limit.allowed) return { ok: false, errors: [], reason: "rate_limited" };
  }
  const result = await publishPageCore({ pageId, userId: user?.id ?? null });
  // Tags are case-sensitive and page ids are stored lower case; the id is a GUID by now.
  if (result.ok) {
    updateTag(pageTag(pageId.toLowerCase()));
    // The Publish may have dropped the last reference to an image the live page used to show (M5-14).
    if (user) await cleanupMediaQuietly(user.id);
  }
  return result;
}
