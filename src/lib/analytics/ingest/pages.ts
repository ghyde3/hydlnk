import "server-only";
import { unstable_cache } from "next/cache";
import { publishedDocSchema } from "@/lib/document";
import { PAGE_REVALIDATE_SECONDS, PUBLIC_READ_CACHE_VERSION, pageTag } from "@/lib/publish/tags";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { findLinkUrl } from "./target";
import type { BeaconPage } from "./types";

/**
 * The two reads the tracking routes make, both with the secret key (RLS does not apply, so these
 * queries are the access rule): only a PUBLISHED page of an account that is not suspended is ever
 * returned, and nothing but the published document is read for a click.
 */

/**
 * For the view beacon: the handle and the verified custom hosts of a published page, which are what
 * the Origin check compares against. Null for an unknown id, a page with nothing published and a
 * suspended owner. The document itself is never read. Throws when the database fails.
 */
export async function lookupBeaconPage(pageId: string): Promise<BeaconPage | null> {
  const { data, error } = await createAdminSupabase()
    .from("pages")
    .select("handle, accounts!inner(suspended_at), domains(hostname, status)")
    .eq("id", pageId)
    .not("published", "is", null)
    .maybeSingle();
  if (error) throw new Error(`Loading page ${pageId} for a view failed: ${error.message}`);
  if (!data || data.accounts.suspended_at !== null) return null;
  return {
    handle: data.handle,
    customHosts: (data.domains ?? [])
      .filter((domain) => domain.status === "verified")
      .map((domain) => domain.hostname.toLowerCase()),
  };
}

/** What the cached click read hands back: plain JSON, so the data cache can store it. */
type PublishedRead = { found: true; published: unknown } | { found: false };

async function readPublished(pageId: string): Promise<PublishedRead> {
  const { data, error } = await createAdminSupabase()
    .from("pages")
    .select("published, accounts!inner(suspended_at)")
    .eq("id", pageId)
    .maybeSingle();
  // A database failure is an error, not a "not found": nobody should be told a link is gone
  // because Postgres hiccuped (and the data cache never stores a throw).
  if (error) throw new Error(`Loading published page ${pageId} for a click failed: ${error.message}`);
  if (!data || data.published === null || data.accounts.suspended_at !== null) {
    return { found: false };
  }
  return { found: true, published: data.published };
}

/**
 * Cached under the page's tag, like the public page itself: Publish expires the tag, so a link
 * edited and republished redirects to its new URL at once, and a suspension or deletion drops it.
 * `next dev` reads Postgres every time (the same rule as `published-page.ts`).
 */
function readPublishedCached(pageId: string): Promise<PublishedRead> {
  if (process.env.NODE_ENV !== "production") return readPublished(pageId);
  return unstable_cache(readPublished, ["click-target", PUBLIC_READ_CACHE_VERSION, pageId], {
    tags: [pageTag(pageId)],
    revalidate: PAGE_REVALIDATE_SECONDS,
  })(pageId);
}

/**
 * The destination of the link with this id in the page's published document, or null: unknown page,
 * nothing published, suspended owner, a document that fails the published schema, an id that is not
 * a link, or a URL that is not plain http(s).
 */
export async function resolveClickTarget(pageId: string, id: string): Promise<string | null> {
  const read = await readPublishedCached(pageId);
  if (!read.found) return null;
  const parsed = publishedDocSchema.safeParse(read.published);
  if (!parsed.success) return null;
  return findLinkUrl(parsed.data, id);
}
