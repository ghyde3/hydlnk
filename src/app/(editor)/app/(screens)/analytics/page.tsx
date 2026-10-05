import type { Metadata } from "next";
import { AnalyticsScreen } from "@/components/analytics/analytics-screen";
import { loadStatsResponse } from "@/lib/analytics/dashboard/load";
import { parsePageFilter } from "@/lib/analytics/dashboard/page-filter";
import { parseRange, rangeWindow } from "@/lib/analytics/dashboard/range";
import { getAppContext } from "@/lib/pages/context";

export const metadata: Metadata = { title: "Analytics" };

/**
 * Analytics (Analytics.dc.html): views, clicks, click-through and unique visitors for the current
 * page over 7, 30, 90 days or a year, a daily chart, clicks by link and referrers, devices and
 * countries (Pro). `?range=7|30|90|365` picks the range, 30 when missing or invalid; `?filter=all|home|<id>` filters by page of the site (M11-09), all when missing or invalid.
 *
 * The page asked about is the signed-in user's current page (`getAppContext`: the `hl-page` cookie
 * names a preference among their own pages, never another account's), and the stats query looks it
 * up again filtered on its owner, so no id from the request ever reaches another account's rows.
 * The gate runs first, like every screen (a layout does not re-run on a soft navigation).
 */
export default async function AnalyticsPage({ searchParams }: PageProps<"/app/analytics">) {
  const { user, current, plan } = await getAppContext();
  const params = await searchParams;
  const range = parseRange(params.range);
  const page = parsePageFilter(params.filter);
  const now = new Date();
  const initial = await loadStatsResponse({
    ownerId: user.id,
    pageId: current.id,
    range,
    page,
    now,
  });
  return (
    // Keyed by page: switching pages (the switcher refreshes the route) starts from fresh state.
    <AnalyticsScreen
      key={current.id}
      initial={initial}
      initialWindow={rangeWindow(range, now)}
      plan={plan}
      initialPage={page}
    />
  );
}
