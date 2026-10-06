import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  ADMIN_PAGE_SIZE,
  REPORTS_LIMIT,
  pageState,
  type AdminPageRow,
  type ReportFilter,
  type ReportRow,
} from "./view";

export * from "./view";

/**
 * Reads for the admin screens, all with the secret key (these screens are behind `requireAdmin`).
 * Reporter text is data: it is returned as plain strings and the components render it as React
 * text, never as markup.
 */

interface RawReport {
  id: string;
  page_id: string | null;
  /** The page's owner when the report was filed (survives the page's deletion). */
  owner_id: string | null;
  reason: string;
  details: string | null;
  reporter_email: string | null;
  created_at: string;
  status: string;
}

/**
 * PostgREST (PGRST205) or Postgres (42P01) saying the table is not there: the reports migration has
 * not been applied to this database yet. The admin screens show "no reports" and log it instead of
 * failing, so the rest of the admin area works while the two migrations are applied in order.
 */
function tableMissing(error: { code?: string }): boolean {
  return error.code === "PGRST205" || error.code === "42P01";
}

const looseDb = (db: ReturnType<typeof createAdminSupabase>) => db as unknown as SupabaseClient;

/**
 * One page of reports, newest first (`REPORTS_LIMIT` a page; `hasMore` says there is a next one),
 * with their page, its owner's suspension and the per-page report count.
 */
export async function listReports(
  filter: ReportFilter,
  page = 1,
): Promise<{ rows: ReportRow[]; hasMore: boolean }> {
  const db = looseDb(createAdminSupabase());
  const from = (Math.max(1, Math.floor(page)) - 1) * REPORTS_LIMIT;
  let query = db
    .from("reports")
    .select("id, page_id, owner_id, reason, details, reporter_email, created_at, status")
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    // One more than a page, to know whether a next page exists.
    .range(from, from + REPORTS_LIMIT);
  if (filter === "open") query = query.eq("status", "open");
  if (filter === "resolved") query = query.in("status", ["dismissed", "actioned"]);
  const reports = await query;
  if (reports.error && tableMissing(reports.error)) {
    console.error("[admin] the reports table does not exist yet");
    return { rows: [], hasMore: false };
  }
  if (reports.error) throw new Error(`Listing reports failed: ${reports.error.message}`);
  const fetched = (reports.data ?? []) as RawReport[];
  const hasMore = fetched.length > REPORTS_LIMIT;
  const rows = fetched.slice(0, REPORTS_LIMIT);

  const pageIds = [...new Set(rows.map((r) => r.page_id).filter((id): id is string => !!id))];
  const pages = new Map<string, { handle: string; owner_id: string }>();
  const counts = new Map<string, number>();
  const suspended = new Map<string, boolean>();
  const ownerPages = new Map<string, number>();
  if (pageIds.length > 0) {
    const [pageRows, countRows] = await Promise.all([
      db.from("pages").select("id, handle, owner_id").in("id", pageIds),
      db.from("reports").select("page_id").in("page_id", pageIds),
    ]);
    if (pageRows.error) throw new Error(`Reading report pages failed: ${pageRows.error.message}`);
    if (countRows.error) throw new Error(`Counting reports failed: ${countRows.error.message}`);
    for (const p of (pageRows.data ?? []) as { id: string; handle: string; owner_id: string }[]) {
      pages.set(p.id, { handle: p.handle, owner_id: p.owner_id });
    }
    for (const r of (countRows.data ?? []) as { page_id: string }[]) {
      counts.set(r.page_id, (counts.get(r.page_id) ?? 0) + 1);
    }
    const ownerIds = [...new Set([...pages.values()].map((p) => p.owner_id))];
    if (ownerIds.length > 0) {
      const [accounts, owned] = await Promise.all([
        db.from("accounts").select("id, suspended_at").in("id", ownerIds),
        db.from("pages").select("owner_id").in("owner_id", ownerIds),
      ]);
      if (accounts.error) throw new Error(`Reading owners failed: ${accounts.error.message}`);
      if (owned.error) throw new Error(`Counting owner pages failed: ${owned.error.message}`);
      for (const p of (owned.data ?? []) as { owner_id: string }[]) {
        ownerPages.set(p.owner_id, (ownerPages.get(p.owner_id) ?? 0) + 1);
      }
      for (const a of (accounts.data ?? []) as { id: string; suspended_at: string | null }[]) {
        suspended.set(a.id, a.suspended_at !== null);
      }
    }
  }

  const mapped = rows.map((r) => {
    const page = r.page_id ? pages.get(r.page_id) : undefined;
    return {
      id: r.id,
      createdAt: r.created_at,
      reason: r.reason,
      details: r.details ?? "",
      reporterEmail: r.reporter_email,
      status: r.status as ReportRow["status"],
      reportCount: r.page_id ? (counts.get(r.page_id) ?? 1) : 1,
      pageDeleted: !page,
      pageId: r.page_id,
      handle: page?.handle ?? null,
      // The owner on record when the report was filed, for a report whose page is gone.
      ownerId: page?.owner_id ?? r.owner_id ?? null,
      ownerSuspended: page ? (suspended.get(page.owner_id) ?? false) : false,
      ownerPageCount: page ? (ownerPages.get(page.owner_id) ?? 0) : 0,
    };
  });
  return { rows: mapped, hasMore };
}

/** How many reports are open, for the admin overview and the Reports tab. */
export async function countOpenReports(): Promise<number> {
  const result = await looseDb(createAdminSupabase())
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (result.error && tableMissing(result.error)) return 0;
  if (result.error) throw new Error(`Counting open reports failed: ${result.error.message}`);
  return result.count ?? 0;
}

export async function searchPages(
  query: string,
  page: number,
): Promise<{ rows: AdminPageRow[]; total: number }> {
  const result = await createAdminSupabase().rpc("admin_search_pages", {
    p_query: query,
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: Math.max(0, page - 1) * ADMIN_PAGE_SIZE,
  });
  if (result.error) throw new Error(`Searching pages failed: ${result.error.message}`);
  const data = result.data ?? [];
  return {
    total: Number(data[0]?.total_count ?? 0),
    rows: data.map((r) => ({
      pageId: r.page_id,
      handle: r.handle,
      ownerId: r.owner_id,
      ownerEmail: r.owner_email ?? "",
      plan: r.plan,
      state: pageState(r.suspended_at, r.published_at),
      pageCount: Number(r.page_count),
    })),
  };
}

/** Accounts that are suspended right now (the overview card). */
export async function countSuspendedAccounts(): Promise<number> {
  const result = await createAdminSupabase()
    .from("accounts")
    .select("id", { count: "exact", head: true })
    .not("suspended_at", "is", null);
  if (result.error) throw new Error(`Counting suspended accounts failed: ${result.error.message}`);
  return result.count ?? 0;
}
