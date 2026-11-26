import "server-only";
import type { SitePageSummary } from "./menu";
import {
  getHomeDraftWithClient,
  getLivePageWithClient,
  getPublishedHomeWithClient,
  listDraftPagesWithClient,
  listLivePagesWithClient,
  type Db,
  type HomeDraft,
  type DraftPage,
  type LivePage,
  type PublishedHome,
} from "./page-entries-core";

/**
 * The secret-key forms of the page-entry reads (M15-05, 1b1-11). The queries themselves, and the
 * `...WithClient` forms that take any client, live in `page-entries-core.ts`, which imports no
 * secret-key client, so the editor's own-session reads (RLS decides) can use them.
 */
export * from "./page-entries-core";

async function adminClient(): Promise<Db> {
  return (await import("@/lib/supabase/admin")).createAdminSupabase();
}

export async function getPublishedHome(siteId: string): Promise<PublishedHome | null> {
  return getPublishedHomeWithClient(await adminClient(), siteId);
}
export async function listLivePages(siteId: string): Promise<SitePageSummary[]> {
  return listLivePagesWithClient(await adminClient(), siteId);
}
export async function getLivePage(siteId: string, pageId: string): Promise<LivePage | null> {
  return getLivePageWithClient(await adminClient(), siteId, pageId);
}
export async function listDraftPages(siteId: string): Promise<DraftPage[]> {
  return listDraftPagesWithClient(await adminClient(), siteId);
}
export async function getHomeDraft(siteId: string): Promise<HomeDraft | null> {
  return getHomeDraftWithClient(await adminClient(), siteId);
}
