import "server-only";
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
import { failIfArmed } from "@/lib/tenant-render/fault";

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
  failIfArmed({ pageId });
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
  failIfArmed({ handle });
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
 * for accounts that are not suspended, through the page's cache tag. The route handler
 * (src/app/(tenant)/t/[handle]/route.ts) is the one caller on the live path, once per generation.
 */
export async function getTenantPageState(handle: string): Promise<TenantPageState> {
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
}

/** The published page for a handle, or null when there is nothing published to show. */
export async function getPublishedPageByHandle(handle: string): Promise<PublishedPage | null> {
  const state = await getTenantPageState(handle);
  return state.kind === "published" ? state.page : null;
}

// ---------------------------------------------------------------------------------------------
// Custom domains (M4-09): the same public read, by page id
// ---------------------------------------------------------------------------------------------

const PAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Public read of a page by id, for /sites/[pageId] (the rewrite target of a verified custom
 * domain). It is the very read the handle host uses (`readPublicCached`: one cache entry and one
 * tag, `pageTag`, per page), so a publish shows on `mara.hydlnk.com` and on its custom domain at
 * the same moment. `published`, the plan and the suspension flag, never `draft`. Anything that is
 * not a published page of an active account is `missing` or `suspended`: the route answers 404.
 * A malformed id (`/sites/<uuid>.txt` is a path the proxy does not see) never reaches the database.
 */
export async function getTenantPageStateById(pageId: string): Promise<TenantPageState> {
  if (!PAGE_ID.test(pageId)) return { kind: "missing" };
  const read = await readPublicCached(pageId);
  if (read.state === "missing") return { kind: "missing" };
  if (read.state === "suspended") return { kind: "suspended" };
  if (read.state === "unpublished") return { kind: "unpublished", pageId };

  const parsed = publishedDocSchema.safeParse(read.published);
  if (!parsed.success) {
    console.error(`Published document for page ${pageId} failed validation`, parsed.error.issues);
    return { kind: "missing" };
  }
  return {
    kind: "published",
    page: { pageId, document: parsed.data, publishedAt: read.publishedAt, plan: read.plan },
  };
}

// ---------------------------------------------------------------------------------------------
// Sub-pages of a handle host (M11-06): the same read, with the handle looked up from the cache
// ---------------------------------------------------------------------------------------------

/** How long a handle's page id is remembered by the sub-page routes (the claim and delete flows expire it at once). */
export const HANDLE_ID_REVALIDATE_SECONDS = 60;

async function readHandleId(handle: string): Promise<string | null> {
  const { data, error } = await createAdminSupabase()
    .from("pages")
    .select("id")
    .eq("handle", handle)
    .maybeSingle();
  if (error) throw new Error(`Looking up page "${handle}" failed: ${error.message}`);
  return data?.id ?? null;
}

/**
 * The id of the page behind a handle, or null (unclaimed), remembered for a minute under the
 * handle's own tag, which the claim flow (`invalidateHandle`) and the delete flows already expire. It
 * is the id only: whether the owner is suspended and what is published are decided by the page's read
 * under its own tag, so a remembered id never shows a page that should be dark. The sub-page routes
 * are dynamic (nothing stored per request), so without this every request of a handle host would
 * look the handle up in Postgres; with it a request costs cached reads only, whatever path it asks
 * for. `next dev` reads every time, like the other public reads.
 */
function handlePageId(handle: string): Promise<string | null> {
  if (process.env.NODE_ENV !== "production") return readHandleId(handle);
  return unstable_cache(readHandleId, ["tenant-handle-id", PUBLIC_READ_CACHE_VERSION, handle], {
    tags: [handleTag(handle)],
    revalidate: HANDLE_ID_REVALIDATE_SECONDS,
  })(handle);
}

/**
 * What a handle host's sub-page route and its sitemap need of the site: Home's public read, found
 * through the cached handle lookup (`getTenantPageState` is for the static Home route, which reads
 * the handle once per generation). Same states as `getTenantPageStateById`.
 */
export async function getTenantSiteState(handle: string): Promise<TenantPageState> {
  if (!handleSchema.safeParse(handle).success) return { kind: "missing" };
  const pageId = await handlePageId(handle);
  if (!pageId) return { kind: "missing" };
  return getTenantPageStateById(pageId);
}
