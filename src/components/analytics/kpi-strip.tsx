import { formatNumber } from "@/lib/analytics/dashboard/format";
import type { StatsData } from "@/lib/analytics/dashboard/types";

/** Views, Clicks, Click-through and Unique visitors: two columns on phones, one row from 760px. */
export function KpiStrip({ kpis }: { kpis: StatsData["kpis"] }) {
  const items: { label: string; value: string; hint?: string }[] = [
    { label: "Views", value: formatNumber(kpis.views) },
    { label: "Clicks", value: formatNumber(kpis.clicks) },
    { label: "Click-through", value: kpis.ctr },
    { label: "Unique visitors", value: formatNumber(kpis.uniques), hint: "Counted per day" },
  ];
  return (
    <dl
      data-testid="kpi-strip"
      className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line hl:grid-cols-4"
    >
      {items.map((item) => (
        <div key={item.label} title={item.hint} className="bg-surface p-3 hl:p-[18px]">
          <dt className="text-[13px] text-text-2">{item.label}</dt>
          <dd className="m-0 mt-1 text-2xl font-bold tracking-[-0.02em] tabular-nums hl:text-[30px]">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
