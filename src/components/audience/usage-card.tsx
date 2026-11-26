import { Card } from "@/components/app/screen";
import { AUDIENCE_TEST_IDS, FORM_NOTIFY_PER_HOUR } from "@/lib/forms/contract";
import type { FormUsage } from "@/lib/forms/usage";
import {
  formDailyLimitNotice,
  formLimitNotice,
  formMeterHelp,
  formMeterText,
  formNotifySkippedNotice,
  type PlanId,
} from "@/lib/limits";
import { meterPercent } from "@/lib/pages/plans";

/**
 * This month's form submissions (M17-02): "{stored} / {limit} this month" over a meter, what is
 * counted (what the forms hold; deleting frees a place) and the per-site daily cap, and, once
 * anything was refused, the over-limit notice of each cap. Every number comes from the limits table.
 * Once owner message emails were skipped today by their hourly cap, a plain line says so (forms
 * attack pass, finding 6): the messages are stored, only the emails were not sent.
 */
export function UsageCard({ usage, plan }: { usage: FormUsage; plan: PlanId }) {
  const notices = [
    formLimitNotice(plan, usage.refused),
    formDailyLimitNotice(plan, usage.refusedDaily),
  ].filter((line): line is string => line !== null);
  const skipped = formNotifySkippedNotice(usage.notifySkippedToday, FORM_NOTIFY_PER_HOUR);
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
      <p className="m-0 text-xs leading-normal text-text-2">{formMeterHelp(plan)}</p>
      {notices.length > 0 ? (
        <div
          role="status"
          data-testid={AUDIENCE_TEST_IDS.overLimit}
          className="m-0 flex flex-col gap-1.5 rounded-md border border-bad px-3 py-2.5 text-[13px] leading-relaxed font-semibold text-bad"
        >
          {notices.map((line) => (
            <p key={line} className="m-0">
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {skipped ? (
        <p
          role="status"
          data-testid={AUDIENCE_TEST_IDS.notifySkipped}
          className="m-0 text-[13px] leading-relaxed text-text-2"
        >
          {skipped}
        </p>
      ) : null}
    </Card>
  );
}
