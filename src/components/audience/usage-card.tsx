import { Card } from "@/components/app/screen";
import { AUDIENCE_TEST_IDS } from "@/lib/forms/contract";
import type { FormUsage } from "@/lib/forms/usage";
import { formLimitNotice, formMeterText, type PlanId } from "@/lib/limits";
import { meterPercent } from "@/lib/pages/plans";

/**
 * This month's form submissions (M17-02): "{stored} / {limit} this month" over a meter, and, once
 * anything was refused, the over-limit notice. Every number comes from the limits table.
 */
export function UsageCard({ usage, plan }: { usage: FormUsage; plan: PlanId }) {
  const notice = formLimitNotice(plan, usage.refused);
  const percent = meterPercent(usage.stored, usage.limit);
  return (
    <Card className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold">Form submissions</h2>
        <span data-testid={AUDIENCE_TEST_IDS.meter} className="font-mono text-[13px] text-text-2">
          {formMeterText(plan, usage.stored)}
        </span>
      </div>
      <span aria-hidden="true" className="block h-1.5 rounded-[2px] bg-track">
        <span
          className={`block h-1.5 rounded-[2px] ${percent >= 90 ? "bg-bad" : "bg-brass"}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <p className="m-0 text-xs leading-normal text-text-2">
        Counted from the 1st of each month (UTC).
      </p>
      {notice ? (
        <p
          role="status"
          data-testid={AUDIENCE_TEST_IDS.overLimit}
          className="m-0 rounded-md border border-bad px-3 py-2.5 text-[13px] leading-relaxed font-semibold text-bad"
        >
          {notice}
        </p>
      ) : null}
    </Card>
  );
}
