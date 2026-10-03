import Link from "next/link";
import { TrafficTable } from "@/components/admin/traffic-table";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { requireAdmin } from "@/lib/admin/auth";
import {
  TRAFFIC_PAGE_SIZE,
  listTrafficFlags,
  parseTrafficFilter,
  parseTrafficPage,
  type TrafficFilter,
} from "@/lib/analytics/admin/queries";

export const metadata = { title: "Traffic" };
export const dynamic = "force-dynamic";

const PAGER =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink no-underline";

const FILTERS: { value: TrafficFilter; label: string }[] = [
  { value: "unreviewed", label: "Unreviewed" },
  { value: "reviewed", label: "Reviewed" },
];

/**
 * /admin/traffic (M5-10): the review list for the nightly high-traffic job. Free pages with more
 * than 100,000 views over the last 30 days land here; they keep serving, an admin only decides what
 * to do. "Mark reviewed" moves a row to the Reviewed filter (and keeps the job quiet about that
 * page for 30 days). A non-admin gets the app's 404 from `requireAdmin`.
 */
export default async function AdminTraffic({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; page?: string | string[] }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const filter = parseTrafficFilter(params.status);
  const page = parseTrafficPage(params.page);
  const { rows, hasMore } = await listTrafficFlags(filter, page);
  const link = (target: number) => {
    const query = new URLSearchParams({
      ...(filter !== "unreviewed" ? { status: filter } : {}),
      ...(target > 1 ? { page: String(target) } : {}),
    }).toString();
    return query ? `/admin/traffic?${query}` : "/admin/traffic";
  };

  return (
    <>
      <ScreenHeader breadcrumb="admin / traffic" title="Traffic" />
      <ScreenBody maxWidth="max-w-[1200px]">
        <p className="text-sm leading-relaxed text-text-2">
          Free pages with more than 100,000 views in the last 30 days. They keep serving.
        </p>
        <nav
          aria-label="Flag status"
          className="flex w-full gap-1 rounded-md bg-track p-1 hl:w-fit"
        >
          {FILTERS.map((item) => {
            const active = item.value === filter;
            return (
              <Link
                key={item.value}
                href={
                  item.value === "unreviewed"
                    ? "/admin/traffic"
                    : `/admin/traffic?status=${item.value}`
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
        {rows.length === 0 ? (
          <Card>
            <p className="text-[15px] leading-relaxed text-text-2">
              {filter === "unreviewed"
                ? "No pages are over the Free-plan traffic line."
                : "No flags have been reviewed yet."}
            </p>
          </Card>
        ) : (
          <>
            <TrafficTable flags={rows} reviewed={filter === "reviewed"} />
            {page > 1 || hasMore ? (
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-xs text-text-2">
                  Page {page}, {TRAFFIC_PAGE_SIZE} a page
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
