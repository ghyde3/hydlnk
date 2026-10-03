import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { publishedDocSchema, type PublishDoc } from "@/lib/document";
import { countPublicQuery } from "@/lib/publish/query-counter";
import {
  MISSING_REVALIDATE_SECONDS,
  PAGE_REVALIDATE_SECONDS,
  PUBLIC_READ_CACHE_VERSION,
  handleTag,
  pageTag,
} from "@/lib/publish/tags";
import { handleSchema } from "@/lib/schemas";

export interface PublishedPage {
  pageId: string;
  document: PublishDoc;
  publishedAt: string | null;
  /** The owner's `accounts.plan`, read here with the page; the footer badge follows it (M2-28). */
  plan: string;
}

/**
 * What a tenant host has to show for a handle (M1-15):
 *   published    the page was published: render its frozen document
 *   unpublished  the handle is claimed but nothing is published yet: the placeholder
 *   suspended    the owner's account is suspended (M5-08): a 404 reading "This page isn't available."
 *                with no content of the page; the handle stays held, so it is never offered as
 *                claimable
 *   missing      nothing to show (unclaimed, malformed, unreadable document): a 404
 */
export type TenantPageState =
  | { kind: "published"; page: PublishedPage }
  | { kind: "unpublished"; pageId: string }
  | { kind: "suspended" }
  | { kind: "missing" };

/** What the cached public read hands back: plain JSON, so the data cache can store it. */
type PublicRead =
  | { state: "published"; published: unknown; publishedAt: string | null; plan: string }
  | { state: "unpublished" }
  | { state: "suspended" }
  | { state: "missing" };

/**
 * The public query (M2-22): `published`, `published_at` and the owner's `accounts` row, for one
 * page id, and nothing else. Never `draft`, never `*`. Server-only, with the secret key: RLS does
 * not apply, so this query is the access rule. A suspended owner reads as `suspended` and the
 * document is never returned for it, so a cached copy of this read cannot carry the page's content
 * (and the tag `invalidateAccountPages` expires drops it at suspend and unsuspend).
 */
async function readPublic(pageId: string): Promise<PublicRead> {
  countPublicQuery(pageId);
  const { data, error } = await createAdminSupabase()
    .from("pages")
    .select("published, published_at, accounts!inner(plan, suspended_at)")
    .eq("id", pageId)
    .maybeSingle();
  // A database failure is a 500, not a 404: nobody should see "not found" for a page that exists.
  if (error) throw new Error(`Loading published page ${pageId} failed: ${error.message}`);
  if (!data) return { state: "missing" };
  if (data.accounts.suspended_at !== null) return { state: "suspended" };
  if (data.published === null) return { state: "unpublished" };
  return {
    state: "published",
    published: data.published,
    publishedAt: data.published_at ?? null,
    plan: data.accounts.plan,
  };
}

/**
 * Pages are static and cached under one tag per page (`pageTag`): Publish expires it with
 * `updateTag`, `invalidateAccountPages` revalidates it for a plan change or a suspension, and
 * autosave never touches it. The tag has to be known when the cache entry is made, so the page id
 * is looked up first: that one-row read happens only when the page is (re)generated, not per view.
 *
 * The cache key carries `PUBLIC_READ_CACHE_VERSION`: the Data Cache outlives a deployment, so a
 * release that tightens the document schema bumps it instead of serving 404s from old entries.
 *
 * `next dev` renders every request on demand and never caches pages; the data cache would still
 * hold a published document across requests there, so development reads Postgres every time.
 */
function readPublicCached(pageId: string): Promise<PublicRead> {
  if (process.env.NODE_ENV !== "production") return readPublic(pageId);
  return unstable_cache(readPublic, ["tenant-page", PUBLIC_READ_CACHE_VERSION, pageId], {
    tags: [pageTag(pageId)],
    revalidate: PAGE_REVALIDATE_SECONDS,
  })(pageId);
}

/**
 * A handle with nothing to show. The page for it is generated and cached like any other, 404
 * included, so this registers a short `revalidate` (and the handle's tag) with the render: the 404
 * is served from the cache for a few seconds at most and a claim (or an unsuspend) is picked up at
 * once when the flow calls `invalidateHandle`. Without it a 404 would be kept for a year.
 */
async function shortLived404(handle: string): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    await unstable_cache(async () => true, ["tenant-handle-missing", handle], {
      revalidate: MISSING_REVALIDATE_SECONDS,
      tags: [handleTag(handle)],
    })();
  }
}

async function missing(handle: string): Promise<TenantPageState> {
  await shortLived404(handle);
  return { kind: "missing" };
}

async function suspended(handle: string): Promise<TenantPageState> {
  await shortLived404(handle);
  return { kind: "suspended" };
}

interface PageLookup {
  id: string;
  /** The owner's account is suspended. */
  suspended: boolean;
}

/**
 * The page behind a handle and whether its owner is suspended, or null (unclaimed). Reads no
 * document. A suspended page is returned, not hidden: that is what keeps its handle held, so the
 * visitor sees "This page isn't available." and never the "Claim it" panel.
 */
async function lookupPage(handle: string): Promise<PageLookup | null> {
  const { data, error } = await createAdminSupabase()
    .from("pages")
    .select("id, accounts!inner(suspended_at)")
    .eq("handle", handle)
    .maybeSingle();
  if (error) throw new Error(`Looking up page "${handle}" failed: ${error.message}`);
  if (!data) return null;
  return { id: data.id, suspended: data.accounts?.suspended_at != null };
}

/** The page id behind a handle, or null (unclaimed or suspended). Reads no document. */
export async function lookupPageId(handle: string): Promise<string | null> {
  const found = await lookupPage(handle);
  return found && !found.suspended ? found.id : null;
}

/**
 * Public read of a tenant page by handle: the published document and nothing else (never `draft`),
 * for accounts that are not suspended, through the page's cache tag. Wrapped in React `cache()` so
 * generateMetadata and the page share one read per request.
 */
export const getTenantPageState = cache(async (handle: string): Promise<TenantPageState> => {
  // Cheap shape check first: garbage hosts and paths never reach the database.
  if (!handleSchema.safeParse(handle).success) return missing(handle);

  const found = await lookupPage(handle);
  if (!found) return missing(handle);
  if (found.suspended) return suspended(handle);
  const pageId = found.id;

  const read = await readPublicCached(pageId);
  if (read.state === "missing") return missing(handle);
  if (read.state === "suspended") return suspended(handle);
  if (read.state === "unpublished") return { kind: "unpublished", pageId };

  const parsed = publishedDocSchema.safeParse(read.published);
  if (!parsed.success) {
    console.error(`Published document for "${handle}" failed validation`, parsed.error.issues);
    return missing(handle);
  }
  return {
    kind: "published",
    page: { pageId, document: parsed.data, publishedAt: read.publishedAt, plan: read.plan },
  };
});

/** The published page for a handle, or null when there is nothing published to show. */
export async function getPublishedPageByHandle(handle: string): Promise<PublishedPage | null> {
  const state = await getTenantPageState(handle);
  return state.kind === "published" ? state.page : null;
}
