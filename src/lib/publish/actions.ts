"use server";

import { updateTag } from "next/cache";
import { siteAccessFor } from "@/lib/access/server";
import { getSessionUser } from "@/lib/auth/session";
import { cleanupMediaQuietly } from "@/lib/media/cleanup-admin";
import { rateLimit } from "@/lib/rate-limit";
import {
  publishDesignCore,
  publishPageCore,
  publishSitePageCore,
  type PagePublishResult,
  type PublishExpected,
  type PublishResult,
  type SitePublishResult,
} from "./core";
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
 *
 * Since M15-10 this is "Publish all changes": the design and every page that changed. `expected` is
 * what the editor holds (the design's rev key and each page entry's rev); when any of them moved the
 * answer is `conflict` and nothing is written. Unchanged pages keep their publish date.
 */
/**
 * The session user and the shared publish rate limit (M11-12): 60 an hour per account, all three
 * actions together. Wave F (G18): a member's publish counts on their own key AND on the site owner's,
 * so members cannot spend more than the owner's budget between them; the owner counts once. The
 * owner comes from the access helper (a read; the core decides publish access itself).
 */
async function publisher(pageId: string): Promise<{
  userId: string | null;
  ownerId: string | null;
  limited: boolean;
}> {
  const user = await getSessionUser();
  if (!user) return { userId: null, ownerId: null, limited: false };
  const site = await siteAccessFor({
    actorId: user.id,
    siteId: typeof pageId === "string" ? pageId.toLowerCase() : pageId,
    need: "read",
    source: "editor",
  });
  const ownerId = site.ok ? site.access.ownerId : null;
  for (const id of new Set([user.id, ownerId ?? user.id])) {
    const limit = await rateLimit(publishRateKey(id), PUBLISH_RATE_LIMIT, PUBLISH_RATE_WINDOW_SECONDS);
    if (!limit.allowed) return { userId: user.id, ownerId, limited: true };
  }
  return { userId: user.id, ownerId, limited: false };
}

/** After a publish that stands: the site's tag (Home, every page, the index), then the OWNER's media queue. */
async function published(pageId: string, ownerId: string | null): Promise<void> {
  // Tags are case-sensitive and page ids are stored lower case; the id is a GUID by now.
  updateTag(pageTag(pageId.toLowerCase()));
  // The Publish may have dropped the last reference to an image the live page used to show (M5-14).
  if (ownerId) await cleanupMediaQuietly(ownerId);
}

export async function publishPage(
  pageId: string,
  expected?: PublishExpected,
): Promise<SitePublishResult> {
  const who = await publisher(pageId);
  if (who.limited) return { ok: false, errors: [], reason: "rate_limited" };
  const result = await publishPageCore({
    pageId,
    userId: who.userId,
    ...(expected === undefined ? {} : { expected }),
  });
  if (result.ok) await published(pageId, who.ownerId);
  return result;
}

/**
 * Publish page (M15-10): one page's draft goes live, Home's or a sub-page's; the design and every
 * other page stay as they are. Takes ids and the entry rev the editor holds and nothing else: the
 * draft is read from Postgres by `publishSitePageCore`, which checks the session user owns the site
 * and that the entry belongs to it. A stale rev answers `conflict` with `currentRev`. The same rate
 * limit as Publish; the site's tag is expired on success only.
 */
export async function publishSitePage(
  pageId: string,
  entryId: string,
  expectedRev: number,
): Promise<PagePublishResult> {
  const who = await publisher(pageId);
  if (who.limited) return { ok: false, errors: [], reason: "rate_limited" };
  const result = await publishSitePageCore({
    pageId,
    entryId,
    expectedRev,
    userId: who.userId,
    source: "editor",
  });
  if (result.ok) await published(pageId, who.ownerId);
  return result;
}

/**
 * Publish design (M15-10): theme, menu and profile go live; no page changes. `expectedRev` is the
 * design's rev key (`pages.draft->>rev`) the editor holds; a stale one answers `conflict`. The same
 * rate limit as Publish; the site's tag is expired on success only.
 */
export async function publishDesign(
  pageId: string,
  expectedRev: string | null,
): Promise<PublishResult> {
  const who = await publisher(pageId);
  if (who.limited) return { ok: false, errors: [], reason: "rate_limited" };
  const result = await publishDesignCore({ pageId, expectedRev, userId: who.userId });
  if (result.ok) await published(pageId, who.ownerId);
  return result;
}
