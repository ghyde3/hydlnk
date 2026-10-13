import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { SitePageSummary } from "./menu";

/**
 * The one read helper for a site's page entries (M15-05, 1b1-11): Home and the sub-pages are the
 * `content_entries` rows of the site's `page` type, and Home is the entry whose path is "/". There
 * is no legacy path and no branching. Trashed entries (`deleted_at`) are never returned.
 *
 * Each read has a `...WithClient` form taking the Supabase client (the secret-key client for public
 * reads, so these queries are the access rule: published copies only; a signed-in client for the
 * owner's own reads under RLS), and a plain form that uses the admin client. The Home entry id is
 * exposed only as `entryId`, for writers; it never appears in a pages list.
 */

export type Db = SupabaseClient<Database>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A stored entry document, validated by the caller with the schema it needs. */
export type EntryDocument = Record<string, unknown>;

export interface PublishedHome {
  entryId: string;
  /** The stored published copy (`{path: "/", title, description, blocks}`), unparsed. */
  published: unknown;
  publishedAt: string | null;
}

export interface LivePage {
  id: string;
  published: unknown;
  publishedAt: string | null;
}

export interface DraftPage {
  id: string;
  rev: number;
  draft: EntryDocument;
  published: unknown;
  livePath: string | null;
  createdAt: string;
}

export interface HomeDraft {
  entryId: string;
  rev: number;
  draft: EntryDocument;
}

/** The site's `page` type id, or null when the site has none. */
async function pageTypeId(client: Db, siteId: string): Promise<string | null> {
  const { data, error } = await client
    .from("content_types")
    .select("id")
    .eq("site_id", siteId)
    .eq("key", "page")
    .maybeSingle();
  if (error) throw new Error(`Loading the page type of site ${siteId} failed: ${error.message}`);
  return data?.id ?? null;
}

const isDocument = (value: unknown): value is EntryDocument =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The published Home entry, or null when the site has none or it is not published. */
export async function getPublishedHomeWithClient(
  client: Db,
  siteId: string,
): Promise<PublishedHome | null> {
  if (!UUID.test(siteId)) return null;
  const typeId = await pageTypeId(client, siteId);
  if (!typeId) return null;
  const { data, error } = await client
    .from("content_entries")
    .select("id, published, published_at")
    .eq("site_id", siteId)
    .eq("type_id", typeId)
    .eq("live_path", "/")
    .is("deleted_at", null)
    .not("published", "is", null)
    .maybeSingle();
  if (error) throw new Error(`Loading Home of site ${siteId} failed: ${error.message}`);
  if (!data) return null;
  return { entryId: data.id, published: data.published, publishedAt: data.published_at };
}

/** The live non-Home pages in path order: id, path and title (what the menu and links need). */
export async function listLivePagesWithClient(
  client: Db,
  siteId: string,
): Promise<SitePageSummary[]> {
  if (!UUID.test(siteId)) return [];
  const typeId = await pageTypeId(client, siteId);
  if (!typeId) return [];
  const { data, error } = await client
    .from("content_entries")
    .select("id, live_path, title:published->>title")
    .eq("site_id", siteId)
    .eq("type_id", typeId)
    .is("deleted_at", null)
    .not("published", "is", null)
    .neq("live_path", "/")
    .order("live_path", { ascending: true });
  if (error) throw new Error(`Loading the pages of site ${siteId} failed: ${error.message}`);
  const pages: SitePageSummary[] = [];
  for (const row of data ?? []) {
    if (typeof row.live_path !== "string" || typeof row.title !== "string") continue;
    pages.push({ id: row.id, path: row.live_path, title: row.title });
  }
  return pages;
}

/** One live non-Home page of the site by entry id, or null (gone, trashed, unpublished, Home). */
export async function getLivePageWithClient(
  client: Db,
  siteId: string,
  pageId: string,
): Promise<LivePage | null> {
  if (!UUID.test(siteId) || !UUID.test(pageId)) return null;
  const typeId = await pageTypeId(client, siteId);
  if (!typeId) return null;
  const { data, error } = await client
    .from("content_entries")
    .select("id, published, published_at")
    .eq("id", pageId)
    .eq("site_id", siteId)
    .eq("type_id", typeId)
    .is("deleted_at", null)
    .not("published", "is", null)
    .neq("live_path", "/")
    .maybeSingle();
  if (error) throw new Error(`Loading page ${pageId} of site ${siteId} failed: ${error.message}`);
  if (!data) return null;
  return { id: data.id, published: data.published, publishedAt: data.published_at };
}

/** Every non-Home page entry of the site that is not in the trash, oldest first. */
export async function listDraftPagesWithClient(client: Db, siteId: string): Promise<DraftPage[]> {
  if (!UUID.test(siteId)) return [];
  const typeId = await pageTypeId(client, siteId);
  if (!typeId) return [];
  const { data, error } = await client
    .from("content_entries")
    .select("id, rev, draft, published, live_path, created_at")
    .eq("site_id", siteId)
    .eq("type_id", typeId)
    .is("deleted_at", null)
    .neq("draft->>path", "/")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`Loading the drafts of site ${siteId} failed: ${error.message}`);
  return (data ?? []).flatMap((row): DraftPage[] =>
    isDocument(row.draft)
      ? [
          {
            id: row.id,
            rev: Number(row.rev),
            draft: row.draft,
            published: row.published,
            livePath: row.live_path,
            createdAt: row.created_at,
          },
        ]
      : [],
  );
}

/** Home's draft with its entry id and rev, or null when the site has no Home entry. */
export async function getHomeDraftWithClient(
  client: Db,
  siteId: string,
): Promise<HomeDraft | null> {
  if (!UUID.test(siteId)) return null;
  const typeId = await pageTypeId(client, siteId);
  if (!typeId) return null;
  const { data, error } = await client
    .from("content_entries")
    .select("id, rev, draft")
    .eq("site_id", siteId)
    .eq("type_id", typeId)
    .is("deleted_at", null)
    .eq("draft->>path", "/")
    .maybeSingle();
  if (error) throw new Error(`Loading Home's draft of site ${siteId} failed: ${error.message}`);
  if (!data || !isDocument(data.draft)) return null;
  return { entryId: data.id, rev: Number(data.rev), draft: data.draft };
}

/**
 * One site document for the readers that still think in `PublishDoc` terms: the site row's design
 * (`pages.published`, whose frozen `blocks` are dropped) with the blocks of Home's published entry.
 * Null when the site row or Home has nothing published.
 */
export function mergeHomePublished(design: unknown, home: PublishedHome | null): unknown {
  if (design === null || design === undefined || !home) return null;
  const blocks = (home.published as { blocks?: unknown } | null)?.blocks;
  return { ...(design as Record<string, unknown>), blocks };
}

/** A page entry of the site with its place in the trash, for the readers that must see trashed pages too. */
export interface PageEntryRow {
  id: string;
  rev: number;
  deletedAt: string | null;
  draft: unknown;
}

/**
 * Every page entry of the site, Home and trashed ones included (a version restore needs to know which
 * of its pages are live, in the trash or gone).
 */
export async function listAllPageEntriesWithClient(
  client: Db,
  siteId: string,
): Promise<PageEntryRow[]> {
  if (!UUID.test(siteId)) return [];
  const typeId = await pageTypeId(client, siteId);
  if (!typeId) return [];
  const { data, error } = await client
    .from("content_entries")
    .select("id, rev, deleted_at, draft")
    .eq("site_id", siteId)
    .eq("type_id", typeId);
  if (error) throw new Error(`Loading the pages of site ${siteId} failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    rev: Number(row.rev),
    deletedAt: row.deleted_at,
    draft: row.draft,
  }));
}

/** The live sub-page entry `entryId` of the site, never Home, as the draft writer reads it; or null. */
export async function readSubPageEntryWithClient(
  client: SupabaseClient,
  siteId: string,
  entryId: string,
): Promise<{ id: string; rev: number; draft: unknown } | null> {
  const type = await client
    .from("content_types")
    .select("id")
    .eq("site_id", siteId)
    .eq("key", "page")
    .maybeSingle();
  if (type.error) throw new Error(`Page type lookup failed: ${type.error.message}`);
  if (!type.data) return null;
  const found = await client
    .from("content_entries")
    .select("id, site_id, rev, draft")
    .eq("id", entryId)
    .eq("site_id", siteId)
    .eq("type_id", (type.data as { id: string }).id)
    .is("deleted_at", null)
    .maybeSingle();
  if (found.error) throw new Error(`Page entry lookup failed: ${found.error.message}`);
  const row = found.data as { id: string; site_id: string; rev: number; draft: unknown } | null;
  if (!row || row.site_id !== siteId) return null;
  if ((row.draft as { path?: unknown } | null)?.path === "/") return null;
  return { id: row.id, rev: Number(row.rev), draft: row.draft };
}

/** The draft and live paths of every page entry of the site not in the trash (paths only, never drafts). */
export async function listPagePathsWithClient(
  client: Db,
  siteId: string,
): Promise<{ draftPath: string | null; livePath: string | null }[]> {
  const existing = await client
    .from("content_entries")
    .select("path:draft->>path, live_path, content_types!inner(key)")
    .eq("site_id", siteId)
    .eq("content_types.key", "page")
    .is("deleted_at", null);
  if (existing.error) throw new Error(`Sub-page lookup failed: ${existing.error.message}`);
  return (existing.data ?? []).map((row) => ({
    draftPath: (row as unknown as { path: string | null }).path,
    livePath: row.live_path,
  }));
}

/** How many sub-page entries the site holds, trash included (what the page-limit trigger counted). */
export async function countSubPageEntriesWithClient(client: Db, siteId: string): Promise<number> {
  const count = await client
    .from("content_entries")
    .select("id, content_types!inner(key)", { count: "exact", head: true })
    .eq("site_id", siteId)
    .eq("content_types.key", "page")
    .neq("draft->>path", "/");
  return count.count ?? 0;
}

/** The sub-page entry of the site that is not Home and not in the trash, with its rev and dates. */
export async function readLiveSubPageWithClient(client: Db, siteId: string, entryId: string) {
  const found = await client
    .from("content_entries")
    .select("id, rev, created_at, published, first_published_at, content_types!inner(key)")
    .eq("id", entryId)
    .eq("site_id", siteId)
    .eq("content_types.key", "page")
    .neq("draft->>path", "/")
    .is("deleted_at", null)
    .maybeSingle();
  if (found.error) throw new Error(`Sub-page lookup failed: ${found.error.message}`);
  return found.data;
}
