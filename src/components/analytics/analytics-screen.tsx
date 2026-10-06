"use client";

import { useRef, useState } from "react";
import { ScreenBody } from "@/components/app/screen";
import { PAGE_FILTER_ALL, type PageFilter } from "@/lib/analytics/dashboard/page-filter";
import { rangeWindow, type RangeDays, type RangeWindow } from "@/lib/analytics/dashboard/range";
import type { StatsData, StatsResponse } from "@/lib/analytics/dashboard/types";
import { PLAN_LIMITS, type PlanId } from "@/lib/limits";
import { BreakdownCards } from "./breakdown-cards";
import { ChartCard } from "./chart-card";
import { ExportRow } from "./export-row";
import { KpiStrip } from "./kpi-strip";
import { LinksTable } from "./links-table";
import { PageSelect } from "./page-select";
import { RangeControl } from "./range-control";
import { Footnote, SampleNote, StatsError, UpgradeCard } from "./states";

/** Where the browser asks for another range's numbers (the stats route next to the page). */
const STATS_URL = "/analytics/stats";

function isResponse(body: unknown): body is StatsResponse {
  return (
    typeof body === "object" && body !== null && typeof (body as { ok?: unknown }).ok === "boolean"
  );
}

/**
 * The Analytics screen (Analytics.dc.html): the header with the date range, then the KPI strip, the
 * daily chart, the clicks-by-link table and the three breakdown cards.
 *
 * The page renders the first range on the server (`initial`), so the numbers are in the HTML. The
 * range control then asks the stats route for another range and rewrites `?range=` in the address
 * bar, so a reload or a shared link shows the same range. A failed request becomes the "We couldn't
 * load your stats" card with Retry; the header and the control stay where they are, so another
 * range can still be chosen. Only the latest request counts, so a slow answer never overwrites a
 * newer choice.
 */
export function AnalyticsScreen({
  initial,
  initialWindow,
  plan,
  initialPage = PAGE_FILTER_ALL,
}: {
  initial: StatsResponse;
  initialWindow: RangeWindow;
  plan: PlanId;
  initialPage?: PageFilter;
}) {
  const [range, setRange] = useState<RangeDays>(initialWindow.range);
  const [pageFilter, setPageFilter] = useState<PageFilter>(initialPage);
  // The options come with the numbers; keep the last ones while a request is in flight or failed,
  // so the select never empties under the user's finger.
  const [pageOptions, setPageOptions] = useState(initial.ok ? initial.data.pages : []);
  const [response, setResponse] = useState<StatsResponse>(initial);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);

  // "Today" is the server's: every other range's window is computed from the same end day.
  const window = rangeWindow(range, new Date(`${initialWindow.end}T12:00:00Z`));
  const lockedFrom = PLAN_LIMITS[plan].analyticsHistoryDays;

  async function load(next: RangeDays, page: PageFilter) {
    const id = ++latest.current;
    setLoading(true);
    let result: StatsResponse = { ok: false, error: "load_failed" };
    try {
      const res = await fetch(`${STATS_URL}?range=${next}&filter=${encodeURIComponent(page)}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const body: unknown = await res.json();
      if (isResponse(body)) result = body;
    } catch {
      // Offline, aborted or not JSON: the same card for all of them.
    }
    if (id !== latest.current) return;
    setResponse(result);
    if (result.ok) setPageOptions(result.data.pages);
    setLoading(false);
  }

  function remember(key: string, value: string) {
    const params = new URLSearchParams(globalThis.location.search);
    params.set(key, value);
    globalThis.history.replaceState(null, "", `${globalThis.location.pathname}?${params}`);
  }

  function select(next: RangeDays) {
    setRange(next);
    remember("range", String(next));
    void load(next, pageFilter);
  }

  function selectPage(next: PageFilter) {
    setPageFilter(next);
    remember("filter", next);
    void load(range, next);
  }

  const data: StatsData | null = response.ok ? response.data : null;

  return (
    <>
      <header className="border-b border-line bg-surface px-4 py-3.5 hl:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div>
            <p className="font-mono text-xs text-text-2">{window.breadcrumb}</p>
            <h1 className="mt-0.5 text-[22px] leading-[1.2] font-bold tracking-[-0.01em]">
              Analytics
            </h1>
          </div>
          <div className="flex w-full flex-col gap-2.5 hl:w-auto hl:flex-row hl:items-center hl:gap-4">
            <div className="flex flex-col items-start gap-1.5 hl:flex-row hl:items-center hl:gap-2.5">
              <span data-testid="date-label" className="font-mono text-xs text-text-2">
                {window.label}
              </span>
              {data?.sample ? (
                <span
                  data-testid="sample-chip"
                  className="rounded-sm bg-track px-1.5 py-0.5 font-mono text-[11px] text-text-2"
                >
                  Sample data
                </span>
              ) : null}
            </div>
            {pageOptions.length > 0 ? (
              <PageSelect options={pageOptions} value={pageFilter} onSelect={selectPage} />
            ) : null}
            <RangeControl range={range} lockedFrom={lockedFrom} onSelect={select} />
          </div>
        </div>
      </header>

      <ScreenBody maxWidth="max-w-[1180px]">
        <div
          aria-busy={loading}
          className={`flex flex-col gap-3 transition-opacity ${loading ? "opacity-60" : ""}`}
        >
          {data ? (
            <>
              {data.sample ? <SampleNote published={data.published} /> : null}
              <KpiStrip kpis={data.kpis} />
              <ChartCard chart={data.chart} views={data.kpis.views} />
              <ExportRow
                range={range}
                page={pageFilter}
                available={!data.sample && data.published}
              />
              <LinksTable links={data.links} views={data.kpis.views} />
              <BreakdownCards breakdowns={data.breakdowns} />
              <Footnote free={data.breakdowns === null} />
            </>
          ) : !response.ok && response.error === "plan_required" ? (
            <>
              <UpgradeCard />
              <Footnote free />
            </>
          ) : (
            <StatsError onRetry={() => void load(range, pageFilter)} />
          )}
        </div>
      </ScreenBody>
    </>
  );
}
