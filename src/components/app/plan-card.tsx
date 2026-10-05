import Link from "next/link";
import { PLAN_INFO, meterPercent, type Plan } from "@/lib/pages/plans";

/**
 * Sidebar plan card: the plan's name, a link to Settings & billing and a meter of pages used
 * against the plan's page limit. Values come from the account's plan and the page count, never
 * from constants in the markup.
 */
export function PlanCard({
  plan,
  pageCount,
  pageLimit,
}: {
  plan: Plan;
  pageCount: number;
  pageLimit: number;
}) {
  const percent = meterPercent(pageCount, pageLimit);
  return (
    <section
      aria-label="Plan"
      className="flex flex-col gap-1 rounded-md border border-ink-2 px-3 py-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold">{PLAN_INFO[plan].label} plan</span>
        <Link
          href="/settings"
          className="inline-flex min-h-11 items-center text-xs text-ink-link no-underline hover:underline"
        >
          Manage
        </Link>
      </div>
      <span className="-mt-1.5 text-xs text-on-ink-muted">
        {pageCount} of {pageLimit} sites
      </span>
      <span aria-hidden="true" className="mt-1 mb-1.5 block h-1 rounded-[2px] bg-ink-2">
        <span
          data-meter-fill
          className="block h-1 rounded-[2px] bg-brass"
          style={{ width: `${percent}%` }}
        />
      </span>
    </section>
  );
}
