import Link from "next/link";
import type { BreakdownRow, Breakdowns } from "@/lib/analytics/dashboard/types";
import { ProChip } from "./range-control";

const CARD = "flex flex-col gap-3 rounded-md border border-line bg-surface p-3.5 hl:p-5";

/** The three cards sit in one grid: one column on phones, as many 280px columns as fit above. */
export const CARD_GRID = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3";

function BreakdownCard({
  id,
  title,
  rows,
}: {
  id: keyof Breakdowns;
  title: string;
  rows: BreakdownRow[];
}) {
  return (
    <section aria-labelledby={`breakdown-${id}`} data-testid={`breakdown-${id}`} className={CARD}>
      <h2 id={`breakdown-${id}`} className="m-0 text-sm font-semibold">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="m-0 text-[13px] text-text-2">No data in this range yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {rows.map((row) => (
            <li key={row.label} data-testid="breakdown-row" className="flex flex-col gap-1.5">
              <div className="flex justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">{row.label}</span>{" "}
                <span className="font-mono text-text-2">{row.pct}%</span>
              </div>
              <span aria-hidden className="block h-1.5 rounded-[2px] bg-track">
                <span
                  className="block h-1.5 rounded-[2px] bg-brass"
                  style={{ width: `${row.pct}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LockedCard({ title }: { title: string }) {
  return (
    <section data-testid="locked-card" aria-label={`${title}, included with Pro`} className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold">{title}</h2>
        <ProChip />
      </div>
      <p className="m-0 text-[13px] text-text-2">Included with Pro</p>
      <Link
        href="/settings#plans"
        className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold hl:w-auto hl:self-start"
      >
        See plans
      </Link>
    </section>
  );
}

/** Top referrers, Devices and Countries; locked cards in the same cells on a plan without them. */
export function BreakdownCards({ breakdowns }: { breakdowns: Breakdowns | null }) {
  if (breakdowns === null) {
    return (
      <div className={CARD_GRID}>
        <LockedCard title="Top referrers" />
        <LockedCard title="Devices" />
        <LockedCard title="Countries" />
      </div>
    );
  }
  return (
    <div className={CARD_GRID}>
      <BreakdownCard id="referrers" title="Top referrers" rows={breakdowns.referrers} />
      <BreakdownCard id="devices" title="Devices" rows={breakdowns.devices} />
      <BreakdownCard id="countries" title="Countries" rows={breakdowns.countries} />
    </div>
  );
}
