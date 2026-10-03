import "server-only";
import { unstable_cache } from "next/cache";
import { PAGE_REVALIDATE_SECONDS, pageTag } from "@/lib/publish/tags";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * The hostname a page's metadata names as its own (og:url, og:image): the oldest verified custom
 * domain of the page, or null. The page is static and shared by every host that serves it, so this
 * is a property of the page, not of the request. It rides on the page's cache tag, and adding,
 * verifying, re-pointing or removing a domain expires that tag (deps-server.ts), so the answer is
 * as fresh as the page. `next dev` reads Postgres every time (see published-page.ts).
 */
async function readPrimaryDomain(pageId: string): Promise<string | null> {
  const { data, error } = await createAdminSupabase()
    .from("domains")
    .select("hostname")
    .eq("page_id", pageId)
    .eq("status", "verified")
    .order("verified_at", { ascending: true })
    .order("hostname", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Looking up the domain of page ${pageId} failed: ${error.message}`);
  return data?.[0]?.hostname ?? null;
}

export function getPrimaryDomain(pageId: string): Promise<string | null> {
  if (process.env.NODE_ENV !== "production") return readPrimaryDomain(pageId);
  return unstable_cache(readPrimaryDomain, ["page-primary-domain", pageId], {
    tags: [pageTag(pageId)],
    revalidate: PAGE_REVALIDATE_SECONDS,
  })(pageId);
}
