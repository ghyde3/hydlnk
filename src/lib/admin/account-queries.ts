import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  ACCOUNT_AUDIT_LIMIT,
  AUDIT_PAGE_SIZE,
  isUuid,
  type AccountApp,
  type AccountDetail,
  type AccountReport,
  type AccountSite,
  type AuditFilter,
  type AuditRow,
} from "./account-view";

/**
 * Reads for the account details and audit log screens (M13-02, M13-05). All with the secret key (the
 * screens are behind `requireAdmin`), all read only. One query path per thing: the account comes from
 * `admin_account_detail(id)`, the lists from named columns of their tables filtered by that one id, so
 * another id is simply another account. Nothing here writes, except `logDraftView`, which appends the
 * audit row of a draft being opened.
 */

type Db = SupabaseClient<Database>;

const asObject = (value: Json): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** The admins' emails for a set of audit rows (`admin_account_emails` reads auth.users). */
async function withAdminEmails(
  db: Db,
  rows: Database["public"]["Tables"]["admin_audit"]["Row"][],
): Promise<AuditRow[]> {
  const ids = [...new Set(rows.map((row) => row.admin_id))];
  const emails = new Map<string, string>();
  if (ids.length > 0) {
    const result = await db.rpc("admin_account_emails", { p_ids: ids });
    if (result.error) throw new Error(`Reading admin emails failed: ${result.error.message}`);
    for (const row of result.data ?? []) emails.set(row.id, row.email);
  }
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    adminId: row.admin_id,
    adminEmail: emails.get(row.admin_id) ?? null,
    action: row.action,
    accountId: row.account_id,
    reportId: row.report_id,
    detail: asObject(row.detail),
  }));
}

/**
 * One page of the audit log, newest first (`AUDIT_PAGE_SIZE` a page; `hasMore` says there is a
 * next one), filtered by account and by action. Read only: nothing else touches the table.
 */
export async function listAudit(
  filter: Pick<AuditFilter, "account" | "action" | "page">,
  db: Db = createAdminSupabase(),
): Promise<{ rows: AuditRow[]; hasMore: boolean }> {
  const from = (Math.max(1, Math.floor(filter.page)) - 1) * AUDIT_PAGE_SIZE;
  let query = db
    .from("admin_audit")
    .select("id, admin_id, action, account_id, report_id, detail, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    // One more than a page, to know whether a next page exists.
    .range(from, from + AUDIT_PAGE_SIZE);
  if (filter.account) query = query.eq("account_id", filter.account);
  if (filter.action) query = query.eq("action", filter.action);
  const result = await query;
  if (result.error) throw new Error(`Reading the audit log failed: ${result.error.message}`);
  const fetched = result.data ?? [];
  return {
    rows: await withAdminEmails(db, fetched.slice(0, AUDIT_PAGE_SIZE)),
    hasMore: fetched.length > AUDIT_PAGE_SIZE,
  };
}

/** Everything the account page shows, or null when no account has that id. */
export async function getAccountDetail(
  id: string,
  db: Db = createAdminSupabase(),
): Promise<AccountDetail | null> {
  if (!isUuid(id)) return null;
  const accountId = id.toLowerCase();
  const detail = await db.rpc("admin_account_detail", { p_id: accountId });
  if (detail.error) throw new Error(`Reading the account failed: ${detail.error.message}`);
  const row = detail.data?.[0];
  if (!row) return null;

  const [pages, grants, reports, audit] = await Promise.all([
    db
      .from("pages")
      .select("id, handle, published, created_at")
      .eq("owner_id", accountId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    db
      .from("oauth_grants")
      .select("id, client_id, scopes, last_used_at, authorized_at")
      .eq("user_id", accountId)
      .is("revoked_at", null)
      .order("authorized_at", { ascending: false }),
    db
      .from("reports")
      .select("id, reason, status, created_at, page_handle")
      .eq("owner_id", accountId)
      .order("created_at", { ascending: false })
      .limit(20),
    listAudit({ account: accountId, action: null, page: 1 }, db).then((r) =>
      r.rows.slice(0, ACCOUNT_AUDIT_LIMIT),
    ),
  ]);
  if (pages.error) throw new Error(`Reading the account's pages failed: ${pages.error.message}`);
  if (grants.error) throw new Error(`Reading the account's apps failed: ${grants.error.message}`);
  if (reports.error)
    throw new Error(`Reading the account's reports failed: ${reports.error.message}`);

  const pageRows = pages.data ?? [];
  const pageIds = pageRows.map((p) => p.id);
  const suspended = row.suspended_at !== null;

  const [subRows, domainRows, clientRows] = await Promise.all([
    pageIds.length
      ? db
          .from("site_pages")
          .select("id, page_id, published_at, path:draft->>path, title:draft->>title")
          .in("page_id", pageIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    pageIds.length
      ? db
          .from("domains")
          .select("id, page_id, hostname, status")
          .in("page_id", pageIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    (grants.data ?? []).length
      ? db
          .from("oauth_clients")
          .select("client_id, client_name")
          .in("client_id", [...new Set((grants.data ?? []).map((g) => g.client_id))])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (subRows.error) throw new Error(`Reading sub-pages failed: ${subRows.error.message}`);
  if (domainRows.error) throw new Error(`Reading domains failed: ${domainRows.error.message}`);
  if (clientRows.error) throw new Error(`Reading apps failed: ${clientRows.error.message}`);

  const sites: AccountSite[] = pageRows.map((page) => ({
    pageId: page.id,
    handle: page.handle,
    published: page.published !== null,
    live: page.published !== null && !suspended,
    subPages: (subRows.data ?? [])
      .filter((s) => s.page_id === page.id)
      .map((s) => {
        const { path, title } = s as unknown as { path: string | null; title: string | null };
        return {
          id: s.id,
          title: typeof title === "string" && title.trim() !== "" ? title : "Untitled",
          path: typeof path === "string" ? path : "",
          live: s.published_at !== null && !suspended,
        };
      }),
    domains: (domainRows.data ?? [])
      .filter((d) => d.page_id === page.id)
      .map((d) => ({ id: d.id, hostname: d.hostname, status: d.status })),
  }));

  const clientNames = new Map((clientRows.data ?? []).map((c) => [c.client_id, c.client_name]));
  const apps: AccountApp[] = (grants.data ?? []).map((g) => ({
    grantId: g.id,
    clientName: clientNames.get(g.client_id) ?? g.client_id,
    scopes: g.scopes,
    lastUsedAt: g.last_used_at,
    authorizedAt: g.authorized_at,
  }));
  const handleOf = new Map(pageRows.map((p) => [p.handle, p.handle]));
  const accountReports: AccountReport[] = (reports.data ?? []).map((r) => ({
    id: r.id,
    reason: r.reason,
    status: r.status,
    createdAt: r.created_at,
    handle: r.page_handle ? (handleOf.get(r.page_handle) ?? r.page_handle) : null,
  }));

  return {
    id: row.id,
    email: row.email ?? "",
    signedUpAt: row.signed_up_at,
    lastSignInAt: row.last_sign_in_at,
    plan: row.plan,
    paidPlan: row.paid_plan,
    giftPlan: row.gift_plan,
    giftUntil: row.gift_until,
    giftReason: row.gift_reason,
    giftActive:
      row.gift_plan !== null &&
      (row.gift_until === null || Date.parse(row.gift_until) > Date.now()),
    suspendedAt: row.suspended_at,
    stripeCustomerId: row.stripe_customer_id,
    uploadBytes: Number(row.upload_bytes),
    siteBytes: Number(row.site_bytes),
    reportsTotal: Number(row.reports_total),
    reportsOpen: Number(row.reports_open),
    sites,
    apps,
    reports: accountReports,
    audit,
  };
}

/** Appends the audit row of one draft being opened (M13-11). Fails loudly: no log, no view. */
export async function logDraftView(
  db: Db,
  entry: { adminId: string; accountId: string; pageId: string; path: string },
): Promise<void> {
  const { error } = await db.from("admin_audit").insert({
    admin_id: entry.adminId,
    action: "view_draft",
    account_id: entry.accountId,
    detail: { page_id: entry.pageId, path: entry.path === "" ? null : entry.path },
  });
  if (error) throw new Error(`Writing the audit log failed: ${error.message}`);
}
