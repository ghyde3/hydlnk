import Link from "next/link";
import { AuditTable } from "@/components/admin/audit-table";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { listAudit } from "@/lib/admin/account-queries";
import {
  AUDIT_ACTIONS,
  auditLabel,
  parseAuditFilter,
  type AuditFilter,
} from "@/lib/admin/account-view";
import { requireAdmin } from "@/lib/admin/auth";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const PAGER =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink no-underline";
const FIELD = "min-h-11 w-full rounded-md border border-line-3 bg-surface px-3 text-base";

/**
 * /admin/audit (M13-05): what admins did, newest first, read only, filtered by account and by
 * action, 50 to a page. A non-admin gets the app's 404 from `requireAdmin`.
 */
export default async function AdminAudit({
  searchParams,
}: {
  searchParams: Promise<{
    account?: string | string[];
    action?: string | string[];
    page?: string | string[];
  }>;
}) {
  await requireAdmin();
  const filter = parseAuditFilter(await searchParams);
  const { rows, hasMore } = await listAudit(filter);
  const link = (target: number, f: AuditFilter) => {
    const query = new URLSearchParams({
      ...(f.account ? { account: f.account } : {}),
      ...(f.action ? { action: f.action } : {}),
      ...(target > 1 ? { page: String(target) } : {}),
    }).toString();
    return query ? `/admin/audit?${query}` : "/admin/audit";
  };

  return (
    <>
      <ScreenHeader breadcrumb="admin / audit" title="Audit log" />
      <ScreenBody maxWidth="max-w-[1200px]">
        <p className="text-sm leading-relaxed text-text-2">
          What admins did, newest first. Nothing here can be changed.
        </p>
        <form
          method="get"
          action="/admin/audit"
          role="search"
          className="flex flex-col gap-3 hl:flex-row hl:items-end"
        >
          <div className="flex flex-col gap-1 hl:w-[360px]">
            <label htmlFor="audit-account" className="text-sm font-semibold">
              Account
            </label>
            <input
              id="audit-account"
              name="account"
              type="search"
              defaultValue={filter.account ?? filter.badAccount ?? ""}
              maxLength={100}
              placeholder="Account id"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className={`${FIELD} font-mono`}
            />
          </div>
          <div className="flex flex-col gap-1 hl:w-[260px]">
            <label htmlFor="audit-action" className="text-sm font-semibold">
              Action
            </label>
            <select
              id="audit-action"
              name="action"
              defaultValue={filter.action ?? ""}
              className={FIELD}
            >
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {auditLabel(action)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-ink bg-ink px-5 text-sm font-semibold text-surface"
          >
            Filter
          </button>
          {filter.account || filter.action ? (
            <Link href="/admin/audit" className={PAGER}>
              Clear
            </Link>
          ) : null}
        </form>
        {filter.badAccount ? (
          <p role="alert" className="text-sm text-bad">
            That isn’t an account id. Copy it from the account’s page.
          </p>
        ) : null}

        {rows.length === 0 ? (
          <Card>
            <p className="text-[15px] text-text-2">
              {filter.account || filter.action ? "No rows match." : "Nothing has been logged yet."}
            </p>
          </Card>
        ) : (
          <>
            <AuditTable rows={rows} />
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-xs text-text-2">Page {filter.page}</p>
              <div className="flex gap-2">
                {filter.page > 1 ? (
                  <Link href={link(filter.page - 1, filter)} className={PAGER}>
                    Previous
                  </Link>
                ) : null}
                {hasMore ? (
                  <Link href={link(filter.page + 1, filter)} className={PAGER}>
                    Next
                  </Link>
                ) : null}
              </div>
            </div>
          </>
        )}
      </ScreenBody>
    </>
  );
}
