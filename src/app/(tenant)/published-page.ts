import "server-only";
import { cache } from "react";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { handleSchema, publishedDocumentSchema, type PublishedDocument } from "@/lib/schemas";

export interface PublishedPage {
  document: PublishedDocument;
  publishedAt: string | null;
}

/**
 * Public read of a tenant page by handle: the published document and nothing else (never `draft`),
 * for accounts that are not suspended. Server-only, with the secret key: RLS does not apply, so the
 * query itself is the access rule. Returns null when there is nothing to show; the caller turns
 * that into a 404.
 *
 * Wrapped in cache() so generateMetadata and the page share one query per request.
 * TODO(M2): add the per-page cache tag and updateTag on publish; today every view hits Postgres.
 */
export const getPublishedPageByHandle = cache(
  async (handle: string): Promise<PublishedPage | null> => {
    // Cheap shape check first: garbage hosts and paths never reach the database.
    if (!handleSchema.safeParse(handle).success) return null;

    const { data, error } = await createAdminSupabase()
      .from("pages")
      .select("published, published_at, accounts!inner(suspended_at)")
      .eq("handle", handle)
      .is("accounts.suspended_at", null)
      .not("published", "is", null)
      .maybeSingle();

    // A database failure is a 500, not a 404: nobody should see "not found" for a page that exists.
    if (error) throw new Error(`Loading published page "${handle}" failed: ${error.message}`);
    if (!data) return null;

    const parsed = publishedDocumentSchema.safeParse(data.published);
    if (!parsed.success) {
      console.error(`Published document for "${handle}" failed validation`, parsed.error.issues);
      return null;
    }
    return { document: parsed.data, publishedAt: data.published_at ?? null };
  },
);
