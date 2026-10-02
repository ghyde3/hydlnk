import Link from "next/link";
import { ReportsTable } from "@/components/admin/reports-table";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { requireAdmin } from "@/lib/admin/auth";
import { listReports } from "@/lib/admin/queries";
import { REPORTS_LIMIT, parseReportFilter, type ReportFilter } from "@/lib/admin/view";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const PAGER =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink no-underline";

const FILTERS: { value: ReportFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

export default async function AdminReports({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; page?: string | string[] }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const filter = parseReportFilter(params.status);
  const rawPage = Number(Array.isArray(params.page) ? params.page[0] : params.page);
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 10_000 ? rawPage : 1;
  const { rows: reports, hasMore } = await listReports(filter, page);
  const link = (target: number) => {
    const query = new URLSearchParams({
      ...(filter !== "open" ? { status: filter } : {}),
      ...(target > 1 ? { page: String(target) } : {}),
    }).toString();
    return query ? `/admin/reports?${query}` : "/admin/reports";
  };
  return (
    <>
      <ScreenHeader breadcrumb="admin / reports" title="Reports" />
      <ScreenBody maxWidth="max-w-[1200px]">
        <nav
          aria-label="Report status"
          className="flex w-full gap-1 rounded-md bg-track p-1 hl:w-fit"
        >
          {FILTERS.map((item) => {
            const active = item.value === filter;
            return (
              <Link
                key={item.value}
                href={
                  item.value === "open" ? "/admin/reports" : `/admin/reports?status=${item.value}`
                }
                aria-current={active ? "true" : undefined}
                className={`flex min-h-11 flex-1 items-center justify-center rounded-sm px-4 text-sm no-underline hl:flex-none ${
                  active
                    ? "bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--hl-line-2)]"
                    : "font-medium text-text-2"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {reports.length === 0 ? (
          <Card>
            <p className="text-[15px] text-text-2">
              {filter === "open" ? "No open reports." : "No reports."}
            </p>
          </Card>
        ) : (
          <>
            <ReportsTable reports={reports} />
            {page > 1 || hasMore ? (
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-xs text-text-2">
                  Page {page}, {REPORTS_LIMIT} a page
                </p>
                <div className="flex gap-2">
                  {page > 1 ? (
                    <Link href={link(page - 1)} className={PAGER}>
                      Previous
                    </Link>
                  ) : null}
                  {hasMore ? (
                    <Link href={link(page + 1)} className={PAGER}>
                      Next
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </ScreenBody>
    </>
  );
}
