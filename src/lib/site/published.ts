import "server-only";
import { unstable_cache } from "next/cache";
import { publishedSubPageSchema, type SubPagePublish } from "@/lib/document";
import { countSiteIndexQuery } from "@/lib/publish/query-counter";
import { PAGE_REVALIDATE_SECONDS, PUBLIC_READ_CACHE_VERSION, pageTag } from "@/lib/publish/tags";
import type { SitePageSummary } from "./menu";
import { getLivePageWithClient, listLivePagesWithClient } from "./page-entries";

/**
 * The public reads of a site's sub-pages (M11-06), from the site's page entries (1b1-12: the
 * non-Home `page` entries of `content_entries`, through `page-entries.ts`). Both are cached in the Data Cache under the
 * site's own tag, `pageTag(pageId)`, the tag of Home's read: Publish (`updateTag`), a plan change, a
 * suspension and a domain change expire Home and every sub-page together, and a deleted page's
 * routes expire it with `invalidatePage`. Published only, never `draft`; the secret key, so these
 * queries are the access rule. Callers check the site itself first (published, owner not suspended)
 * with the public read of Home (`published-page.ts`).
 *
 * Why two reads. A request to `/{path}` on a site's host must cost a bounded amount whatever the
 * visitor typed. The INDEX is one cached read per site, `["tenant-site-index", version, pageId]`:
 * the live sub-pages' id, path and title, small whatever the page sizes. An invented path is looked
 * up in it and answers the 404 without a read of its own. A path that is in it reads the page by its
 * REAL id, `["tenant-sub-page", version, subPageId]`, one entry per real page. The same index draws
 * the menu and the page links of Home and of every sub-page, and the sitemap.
 *
 * `next dev` reads Postgres every time, like Home's read.
 */

/** Loaded on first read, not at import: modules that only need the shapes load without the server env. */
async function adminClient() {
  return (await import("@/lib/supabase/admin")).createAdminSupabase();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readIndex(pageId: string): Promise<SitePageSummary[]> {
  countSiteIndexQuery(pageId);
  return listLivePagesWithClient(await adminClient(), pageId);
}

/**
 * The live sub-pages of a site, in path order: id, path and title, a few dozen bytes per page (a
 * site has at most 500). Read once per generation, never per request.
 */
export function getSiteIndex(pageId: string): Promise<SitePageSummary[]> {
  if (!UUID.test(pageId)) return Promise.resolve([]);
  if (process.env.NODE_ENV !== "production") return readIndex(pageId);
  return unstable_cache(readIndex, ["tenant-site-index", PUBLIC_READ_CACHE_VERSION, pageId], {
    tags: [pageTag(pageId)],
    revalidate: PAGE_REVALIDATE_SECONDS,
  })(pageId);
}

/** What the cached read hands back: plain JSON, validated after it is read. */
type SubPageRead = { published: unknown; publishedAt: string | null } | null;

async function readSubPage(pageId: string, subPageId: string): Promise<SubPageRead> {
  const page = await getLivePageWithClient(await adminClient(), pageId, subPageId);
  if (!page) return null;
  return { published: page.published, publishedAt: page.publishedAt };
}

export interface PublishedSubPage {
  id: string;
  document: SubPagePublish;
  publishedAt: string | null;
}

/** The published document of one sub-page of the site, or null (gone, unpublished, unreadable). */
export async function getPublishedSubPage(
  pageId: string,
  subPageId: string,
): Promise<PublishedSubPage | null> {
  if (!UUID.test(pageId) || !UUID.test(subPageId)) return null;
  const read =
    process.env.NODE_ENV !== "production"
      ? await readSubPage(pageId, subPageId)
      : await unstable_cache(
          readSubPage,
          ["tenant-sub-page", PUBLIC_READ_CACHE_VERSION, subPageId],
          { tags: [pageTag(pageId)], revalidate: PAGE_REVALIDATE_SECONDS },
        )(pageId, subPageId);
  if (!read) return null;
  const parsed = publishedSubPageSchema.safeParse(read.published);
  if (!parsed.success) {
    console.error(
      `Published page ${subPageId} of site ${pageId} failed validation`,
      parsed.error.issues,
    );
    return null;
  }
  return { id: subPageId, document: parsed.data, publishedAt: read.publishedAt };
}
