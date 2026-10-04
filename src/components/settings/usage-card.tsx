import { Card } from "@/components/app/screen";
import { cn } from "@/lib/cn";
import type { Meter, PlanId } from "@/lib/limits";
import { meterLevel, meterStateText } from "./meter-state";

/**
 * The Usage card (M4-32, Billing.dc.html): four meters in an auto-fit grid (190px minimum). Each is
 * a label, a mono 13px value, and a 6px track (#EFEDE9) with a brass fill of min(100%, used / limit);
 * "no limit" and "Not included" read as a dashed empty track, and a meter past its limit (after a
 * downgrade) keeps a full fill and says what that means under it. From 90% the fill is --hl-bad
 * (#B23A2B) and the meter reads "Almost full"; at 100% it says what to do ("Full. Remove an image or
 * upgrade." on Uploads, see meter-state.ts). Below 90% the fill stays brass.
 */
export function UsageCard({ meters, plan = "free" }: { meters: Meter[]; plan?: PlanId }) {
  return (
    <Card className="flex flex-col gap-3.5">
      <h2 className="text-sm font-semibold">Usage</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,190px),1fr))] gap-x-5 gap-y-4">
        {meters.map((meter) => {
          const level = meterLevel(meter);
          const state = meterStateText(meter, plan);
          return (
            <div
              key={meter.key}
              data-meter={meter.key}
              data-over={meter.over ? "true" : undefined}
              data-meter-level={meter.dashed ? undefined : level}
              className="flex min-w-0 flex-col gap-1.5"
            >
              <div className="flex justify-between gap-2 text-[13px]">
                <span>{meter.label}</span>
                <span data-meter-text className="font-mono text-[13px] text-text-2">
                  {meter.text}
                </span>
              </div>
              {meter.dashed ? (
                <span
                  aria-hidden="true"
                  data-meter-track="dashed"
                  className="box-border block h-1.5 rounded-[2px] border border-dashed border-line-3"
                />
              ) : (
                <span
                  aria-hidden="true"
                  data-meter-track="solid"
                  className="block h-1.5 rounded-[2px] bg-track"
                >
                  <span
                    data-meter-fill
                    className={cn(
                      "block h-1.5 rounded-[2px]",
                      level === "ok" ? "bg-brass" : "bg-bad",
                    )}
                    style={{ width: `${meter.percent}%` }}
                  />
                </span>
              )}
              {meter.note ? (
                <p data-meter-note className="text-xs leading-normal text-text-2">
                  {meter.note}
                </p>
              ) : null}
              {state ? (
                <p
                  data-meter-state={level}
                  className="text-xs leading-normal font-semibold text-bad"
                >
                  {state}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
