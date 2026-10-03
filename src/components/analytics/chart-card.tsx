import { formatNumber } from "@/lib/analytics/dashboard/format";
import type { ChartData } from "@/lib/analytics/dashboard/types";
import { Panel } from "./panel";

const GRIDLINES = {
  background:
    "linear-gradient(var(--hl-track), var(--hl-track)) 0 0 / 100% 1px no-repeat, linear-gradient(var(--hl-track), var(--hl-track)) 0 100px / 100% 1px no-repeat",
};

/**
 * "Views and clicks per day": plain CSS bars, no chart library. The grey bar is the day's views,
 * its brass part the share of those that clicked. Seven to 90 days draw a bar per day, a year 52
 * weekly bars. Each bar's tooltip says its numbers; the container is one labelled image for
 * assistive tech (the bars and the axis are decoration).
 */
export function ChartCard({ chart, views }: { chart: ChartData; views: number }) {
  return (
    <Panel testId="chart-card" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-sm font-semibold">Views and clicks per day</h2>
        <div className="flex gap-4 text-[13px] text-text-2">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 rounded-[2px] bg-line-2" />
            Views
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 rounded-[2px] bg-brass" />
            Clicks
          </span>
        </div>
      </div>
      <div className="flex gap-2.5">
        <div
          aria-hidden
          className="flex h-[200px] flex-none flex-col justify-between text-right font-mono text-[11px] text-text-2"
        >
          <span>{formatNumber(chart.yMax)}</span>
          <span>{formatNumber(chart.yMid)}</span>
          <span>0</span>
        </div>
        <div className="min-w-0 flex-1">
          <div
            role="img"
            aria-label={chart.ariaLabel}
            data-testid="chart-bars"
            style={GRIDLINES}
            className={`flex h-[200px] items-end border-b border-line-3 ${chart.bars.length > 60 ? "gap-px" : "gap-0.5"}`}
          >
            {chart.bars.map((bar) => (
              <div
                key={bar.key}
                title={bar.tip}
                data-bar={bar.drawn ? "drawn" : "empty"}
                className="flex h-full min-w-0 flex-1 cursor-default items-end"
              >
                {bar.drawn ? (
                  <div
                    className="flex w-full items-end overflow-hidden rounded-t-[2px] bg-line-2"
                    style={{ height: `${bar.heightPct}%` }}
                  >
                    {bar.clickPct > 0 ? (
                      <div
                        className="box-border w-full border-t-2 border-surface bg-brass"
                        style={{ height: `${bar.clickPct}%` }}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div
            aria-hidden
            className="mt-1.5 flex justify-between font-mono text-[11px] text-text-2"
          >
            {chart.xLabels.map((label, index) => (
              <span key={index}>{label}</span>
            ))}
          </div>
        </div>
      </div>
      {views === 0 ? (
        <p data-testid="no-views" className="m-0 text-[13px] text-text-2">
          No views in this range.
        </p>
      ) : null}
    </Panel>
  );
}
