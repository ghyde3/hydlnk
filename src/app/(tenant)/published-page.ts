import "server-only";
import { cache } from "react";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { publishedDocSchema, type PublishDoc } from "@/lib/document";
import { handleSchema } from "@/lib/schemas";

export interface PublishedPage {
  document: PublishDoc;
  publishedAt: string | null;
}

/**
 * What a tenant host has to show for a handle (M1-15):
 *   published    the page was published: render its frozen document
 *   unpublished  the handle is claimed but nothing is published yet: the placeholder
 *   missing      nothing to show (unclaimed, suspended, malformed, unreadable document): a 404
 */
export type TenantPageState =
  { kind: "published"; page: PublishedPage } | { kind: "unpublished" } | { kind: "missing" };

/**
 * Public read of a tenant page by handle: the published document and nothing else (never `draft`),
 * for accounts that are not suspended. Server-only, with the secret key: RLS does not apply, so the
 * query itself is the access rule. Only `published` and `published_at` are selected; the draft
 * column is never read on a public path.
 *
 * Wrapped in cache() so generateMetadata and the page share one query per request.
 * TODO(M2): add the per-page cache tag and updateTag on publish; today every view hits Postgres.
 */
export const getTenantPageState = cache(async (handle: string): Promise<TenantPageState> => {
  // Cheap shape check first: garbage hosts and paths never reach the database.
  if (!handleSchema.safeParse(handle).success) return { kind: "missing" };

  const { data, error } = await createAdminSupabase()
    .from("pages")
    .select("published, published_at, accounts!inner(suspended_at)")
    .eq("handle", handle)
    .is("accounts.suspended_at", null)
    .maybeSingle();

  // A database failure is a 500, not a 404: nobody should see "not found" for a page that exists.
  if (error) throw new Error(`Loading published page "${handle}" failed: ${error.message}`);
  if (!data) return { kind: "missing" };
  if (data.published === null) return { kind: "unpublished" };

  const parsed = publishedDocSchema.safeParse(data.published);
  if (!parsed.success) {
    console.error(`Published document for "${handle}" failed validation`, parsed.error.issues);
    return { kind: "missing" };
  }
  return {
    kind: "published",
    page: { document: parsed.data, publishedAt: data.published_at ?? null },
  };
});

/** The published page for a handle, or null when there is nothing published to show. */
export async function getPublishedPageByHandle(handle: string): Promise<PublishedPage | null> {
  const state = await getTenantPageState(handle);
  return state.kind === "published" ? state.page : null;
}
