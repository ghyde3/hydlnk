import { Card } from "@/components/app/screen";
import type { Meter } from "@/lib/limits";

/**
 * The Usage card (M4-32, Billing.dc.html): four meters in an auto-fit grid (190px minimum). Each is
 * a label, a mono 13px value, and a 6px track (#EFEDE9) with a brass fill of min(100%, used / limit);
 * "no limit" and "Not included" read as a dashed empty track, and a meter past its limit (after a
 * downgrade) keeps a full fill and says what that means under it.
 */
export function UsageCard({ meters }: { meters: Meter[] }) {
  return (
    <Card className="flex flex-col gap-3.5">
      <h2 className="text-sm font-semibold">Usage</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,190px),1fr))] gap-x-5 gap-y-4">
        {meters.map((meter) => (
          <div
            key={meter.key}
            data-meter={meter.key}
            data-over={meter.over ? "true" : undefined}
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
                  className="block h-1.5 rounded-[2px] bg-brass"
                  style={{ width: `${meter.percent}%` }}
                />
              </span>
            )}
            {meter.note ? (
              <p data-meter-note className="text-xs leading-normal text-text-2">
                {meter.note}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
